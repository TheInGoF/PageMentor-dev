// M4B-Hörbuch bauen
import { writeFileSync, statSync, existsSync } from "fs";
import { run } from "./run";
import { concatMp3, probeDurationMs } from "./mp3";
import { buildFfMetadata } from "./metadata";

// M4B bauen: AAC mit Kapitelmarken, Metadaten, Cover
// title = Dokumenttitel, artist = Autor, album = Titel
// grouping = Kürzel, genre = Audiobook
export async function buildM4B(params: {
  inputs: string[];
  chapters: Array<{ title: string; durationMs: number }>;
  output: string;
  title: string;
  artist?: string;
  shortCode?: string;
  // Serienname, z. B. Modul; Audiobookshelf liest den Tag series
  series?: string;
  // Position in der Serie, landet als track + movement_index
  seriesSequence?: string;
  coverPath?: string;
  // Fortschritt beim Encoden: aktuelle Position und Gesamtdauer in ms
  onProgress?: (currentMs: number, totalMs: number) => void;
}): Promise<void> {
  const buildStart = Date.now();
  // Reste eines abgebrochenen Laufs löschen, auch ein halbes M4B
  const merged = params.output.replace(/\.m4b$/i, ".merged.mp3");
  const metaPath = params.output.replace(/\.m4b$/i, ".ffmeta");
  const { unlinkSync } = await import("fs");
  let cleaned = 0;
  for (const stale of [merged, metaPath, params.output]) {
    if (existsSync(stale)) {
      try {
        unlinkSync(stale);
        cleaned++;
      } catch {
        // best effort
      }
    }
  }
  console.log(`[m4b] stale-cleanup removed ${cleaned} leftover files`);

  // 1. Eingaben zu einer MP3 verbinden
  const concatStart = Date.now();
  await concatMp3(params.inputs, merged);
  const mergedSize = existsSync(merged) ? statSync(merged).size : 0;
  console.log(
    `[m4b] concat ${params.inputs.length} chunks → ${merged} (${(mergedSize / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - concatStart) / 1000).toFixed(1)}s`
  );

  // 2. FFMETADATA mit Kapitelmarken
  const meta = buildFfMetadata({
    title: params.title,
    artist: params.artist ?? "PageMentor",
    shortCode: params.shortCode,
    series: params.series,
    seriesSequence: params.seriesSequence,
    chapters: params.chapters,
  });
  writeFileSync(metaPath, meta);

  const coverExists =
    params.coverPath !== undefined && existsSync(params.coverPath);
  console.log(
    `[m4b] build ${params.output} title=${JSON.stringify(params.title)} ` +
      `artist=${JSON.stringify(params.artist ?? "PageMentor")} ` +
      `subtitle=${JSON.stringify(params.shortCode ?? "")} ` +
      `series=${JSON.stringify(params.series ?? "")} ` +
      `cover=${coverExists ? params.coverPath : "(no file found)"}`
  );

  // 3. Nach AAC/M4B encoden; Fortschritt alle 5 s im Log
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "info",
    "-stats",
    "-i",
    merged,
    "-i",
    metaPath,
  ];
  if (coverExists) args.push("-i", params.coverPath!);
  args.push(
    "-map_metadata",
    "1",
    "-map_chapters",
    "1",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart"
  );
  if (coverExists) {
    args.push(
      "-map",
      "0:a",
      "-map",
      "2:v",
      "-c:v",
      "mjpeg",
      "-disposition:v",
      "attached_pic"
    );
  }
  args.push(params.output);
  const encodeStart = Date.now();
  // Gesamtdauer einmal messen, ffmpeg liefert nur die aktuelle Zeit
  const totalMs = params.onProgress
    ? await probeDurationMs(merged).catch(() => 0)
    : 0;
  if (params.onProgress && totalMs > 0) {
    params.onProgress(0, totalMs);
  }
  const timeRegex = /\btime=(\d+):(\d+):(\d+)\.(\d+)/;
  const { stderr } = await run("ffmpeg", args, {
    liveStderr: true,
    logPrefix: "[ffmpeg:m4b]",
    onStderrLine: (line) => {
      if (!params.onProgress || totalMs <= 0) return;
      const m = timeRegex.exec(line);
      if (!m) return;
      const currentMs =
        (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] * 10;
      params.onProgress(currentMs, totalMs);
    },
  });
  const outSize = existsSync(params.output)
    ? statSync(params.output).size
    : 0;
  console.log(
    `[m4b] encode ${params.output} (${(outSize / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - encodeStart) / 1000).toFixed(1)}s`
  );
  // Letzte stderr-Zeilen helfen, wenn das M4B zu klein ist
  const tailLines = stderr.trim().split(/\r?\n/).slice(-8).join(" | ");
  if (tailLines) {
    console.log(`[m4b] ffmpeg tail: ${tailLines}`);
  }

  // Bekannte Grenze: ffmpeg schreibt das Untertitel-Atom ©st3 nicht
  // Untertitel kommt nur per Audiobookshelf-PATCH

  // Apple-Books-Atome stik und pgap per AtomicParsley nachziehen
  // Ohne stik=2 erkennt Apple Books kein Hörbuch
  await applyAppleBooksAtoms(params.output);

  // Aufräumen
  for (const stale of [merged, metaPath]) {
    if (existsSync(stale)) {
      try {
        unlinkSync(stale);
      } catch {
        // best effort
      }
    }
  }
  console.log(
    `[m4b] build done in ${((Date.now() - buildStart) / 1000).toFixed(1)}s total`
  );
}


// Apple-Books-Atome setzen: stik=2 Hörbuch, pgap gapless
// Fehler nur loggen: M4B ist trotzdem überall sonst gültig
async function applyAppleBooksAtoms(file: string): Promise<void> {
  if (!existsSync(file)) {
    console.warn(`[m4b] applyAppleBooksAtoms: file missing ${file}`);
    return;
  }
  const beforeSize = statSync(file).size;
  try {
    const { stderr } = await run(
      "AtomicParsley",
      [file, "--stik", "Audiobook", "--gapless", "true", "--overWrite"],
      { logPrefix: "[m4b:atoms]" }
    );
    const afterSize = statSync(file).size;
    // AtomicParsley kann Temp-Dateien hinterlassen, Größe prüfen
    const delta = Math.abs(afterSize - beforeSize);
    console.log(
      `[m4b] AtomicParsley stik=Audiobook ok (${beforeSize} → ${afterSize} bytes, Δ ${delta})`
    );
    if (stderr.trim().length > 0) {
      console.log(`[m4b] AtomicParsley stderr: ${stderr.trim().slice(-200)}`);
    }
  } catch (err) {
    console.warn(
      `[m4b] AtomicParsley failed (${(err as Error).message}). ` +
        `M4B still works for ABS/VLC/Plex but Apple Books may not import it.`
    );
  }
}
