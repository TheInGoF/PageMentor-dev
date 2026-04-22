import { spawn } from "child_process";
import { writeFileSync, statSync, existsSync } from "fs";
import { join, dirname, basename } from "path";

/**
 * Thin ffmpeg/ffprobe Wrapper. Setzt voraus, dass ffmpeg im PATH liegt
 * (im Docker-Image via apk add ffmpeg; lokal via brew install ffmpeg).
 */

export async function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Concat MP3 files with identical encoding (stream copy). */
/**
 * Ändert das Wiedergabe-Tempo einer MP3-Datei via ffmpeg `atempo`-
 * Filter, ohne Tonhöhe zu verschieben.
 *
 * `atempo` akzeptiert nur 0.5 ≤ f ≤ 2.0. Für Werte außerhalb müssten
 * wir verketten (atempo=2.0,atempo=2.0 für 4×), aber unser Edge-Rate-
 * Format "+/-30%" liegt ohnehin im [0.7, 1.3]-Bereich — safe.
 *
 * `factor > 1` = schneller (Audio wird kürzer), `< 1` = langsamer.
 * `factor === 1` ist Opt-out und macht einen Dateikopie-Trick statt
 * Re-Encode (spart Qualitätsverlust).
 */
export async function applyAtempo(
  inPath: string,
  outPath: string,
  factor: number
): Promise<void> {
  if (Math.abs(factor - 1.0) < 1e-3) {
    // Identity — einfach kopieren (bzw. umbenennen wenn das OK ist).
    if (inPath !== outPath) {
      const { copyFile } = await import("fs/promises");
      await copyFile(inPath, outPath);
    }
    return;
  }
  const clamped = Math.max(0.5, Math.min(2.0, factor));
  await run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inPath,
    "-filter:a",
    `atempo=${clamped.toFixed(3)}`,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "96k",
    outPath,
  ]);
}

export async function concatMp3(inputs: string[], output: string): Promise<void> {
  const listPath = join(dirname(output), `.concat-${basename(output)}.txt`);
  const content = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  writeFileSync(listPath, content);
  await run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    output,
  ]);
}

/**
 * Concat wie `concatMp3`, aber mit Silence-Pads zwischen den Inputs
 * (`interChunkMs`) und/oder am Ende (`trailingMs`).
 *
 * Zweck: Qwen3-TTS-Base ignoriert `\n\n` und rattert Absatzgrenzen
 * durch. Kurze Pause zwischen Chunks = Denk-Pause zwischen Absätzen.
 * Trailing-Pause am Kapitel-Ende = Absatz vor dem nächsten Kapitel
 * bzw. vor M4B-Konkatenation.
 *
 * Silence-MP3 wird mit der Sample-Rate des ersten Inputs erzeugt, damit
 * der stream-copy-Concat ohne Codec-Mismatch durchläuft.
 */
export async function concatMp3WithGaps(
  inputs: string[],
  output: string,
  opts: { interChunkMs?: number; trailingMs?: number } = {}
): Promise<void> {
  if (inputs.length === 0) {
    throw new Error("concatMp3WithGaps: inputs is empty");
  }
  const interMs = Math.max(0, opts.interChunkMs ?? 0);
  const trailMs = Math.max(0, opts.trailingMs ?? 0);

  if (interMs === 0 && trailMs === 0) {
    return concatMp3(inputs, output);
  }

  const sr = (await probeSampleRate(inputs[0])) ?? 24000;
  const dir = dirname(output);
  const silenceByMs = new Map<number, string>();

  const ensureSilence = async (ms: number): Promise<string> => {
    const cached = silenceByMs.get(ms);
    if (cached) return cached;
    const p = join(dir, `.silence-${sr}Hz-${ms}ms.mp3`);
    await run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `anullsrc=r=${sr}:cl=mono`,
      "-t",
      (ms / 1000).toFixed(3),
      "-c:a",
      "libmp3lame",
      "-b:a",
      "96k",
      p,
    ]);
    silenceByMs.set(ms, p);
    return p;
  };

  const seq: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    seq.push(inputs[i]);
    if (interMs > 0 && i < inputs.length - 1) {
      seq.push(await ensureSilence(interMs));
    }
  }
  if (trailMs > 0) {
    seq.push(await ensureSilence(trailMs));
  }

  try {
    await concatMp3(seq, output);
  } finally {
    const { unlink } = await import("fs/promises");
    for (const p of silenceByMs.values()) {
      try {
        await unlink(p);
      } catch {
        // best effort
      }
    }
  }
}

async function probeSampleRate(file: string): Promise<number | null> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=sample_rate",
      "-of",
      "default=nokey=1:noprint_wrappers=1",
      file,
    ]);
    const n = parseInt(stdout.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Loudnorm (EBU R128 → Podcast-Standard -16 LUFS) + Re-Encode auf
 * 128kbps MP3 mit ID3-Tags. Gibt die Laufzeit in Millisekunden zurück.
 */
export async function normalizeAndTag(params: {
  input: string;
  output: string;
  title: string;
  album: string;
  artist?: string;
  trackNumber?: number;
  trackTotal?: number;
  coverPath?: string;
}): Promise<{ durationMs: number }> {
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    params.input,
  ];
  if (params.coverPath) args.push("-i", params.coverPath);
  args.push(
    "-af",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar",
    "24000",
    "-ac",
    "1",
    "-b:a",
    "128k",
    "-id3v2_version",
    "3",
    "-metadata",
    `title=${params.title}`,
    "-metadata",
    `album=${params.album}`,
    "-metadata",
    `artist=${params.artist ?? "PageMentor"}`,
    "-metadata",
    `genre=Audiobook`
  );
  if (params.trackNumber) {
    args.push(
      "-metadata",
      `track=${params.trackNumber}${params.trackTotal ? "/" + params.trackTotal : ""}`
    );
  }
  if (params.coverPath) {
    args.push(
      "-map",
      "0:a",
      "-map",
      "1:v",
      "-c:v",
      "mjpeg",
      "-disposition:v",
      "attached_pic"
    );
  }
  args.push(params.output);
  await run("ffmpeg", args);
  return { durationMs: await probeDurationMs(params.output) };
}

export async function probeDurationMs(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nokey=1:noprint_wrappers=1",
    file,
  ]);
  const secs = parseFloat(stdout.trim());
  if (!Number.isFinite(secs)) return 0;
  return Math.round(secs * 1000);
}

/**
 * Baut ein M4B (AAC in MP4) mit Kapitelmarken + Metadaten + Cover.
 * `chapters` wird als FFMETADATA-File an ffmpeg übergeben.
 *
 * Metadaten-Layout:
 * - title  = Doc-Titel (was der User im UI sieht)
 * - artist = Author aus der PDF-Metadata (oder "PageMentor" fallback)
 * - album  = Titel (iTunes zeigt M4B-Hörbücher gruppiert nach Album)
 * - grouping = shortCode (User-Kürzel, z. B. „SE12k" / „1" / „2")
 * - genre  = Audiobook
 */
export async function buildM4B(params: {
  inputs: string[];
  chapters: Array<{ title: string; durationMs: number }>;
  output: string;
  title: string;
  artist?: string;
  shortCode?: string;
  /** Serien-Name (z. B. Modul-Name). Landet als `series`-Metadata-Tag
   *  — das ist der primäre Tag den Audiobookshelf per ffprobe liest.
   *  `mvnm` wäre der dokumentierte Fallback, wird aber von ffprobe
   *  nicht zuverlässig extrahiert, also lassen wir's weg. */
  series?: string;
  coverPath?: string;
}): Promise<void> {
  // Stale-Zwischendateien aus einem früheren abgebrochenen Build
  // aufräumen, sonst führt das zu Inkonsistenzen (kaputte M4B neben
  // einer 120-MB-merged.mp3, kein Weg das vom User aus zu heilen).
  // Auch die Ziel-M4B killen, falls sie truncated liegen geblieben ist.
  const merged = params.output.replace(/\.m4b$/i, ".merged.mp3");
  const metaPath = params.output.replace(/\.m4b$/i, ".ffmeta");
  for (const stale of [merged, metaPath, params.output]) {
    if (existsSync(stale)) {
      try {
        await run("rm", ["-f", stale]);
      } catch {
        // best effort; ffmpeg wird gleich den Pfad sowieso überschreiben
      }
    }
  }

  // 1. Concat inputs to a single MP3 first (stream copy).
  await concatMp3(params.inputs, merged);

  // 2. Build FFMETADATA with chapter markers
  const meta = buildFfMetadata({
    title: params.title,
    artist: params.artist ?? "PageMentor",
    shortCode: params.shortCode,
    series: params.series,
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
      `cover=${coverExists ? params.coverPath : "(keine Datei gefunden)"}`
  );

  // 3. Encode to AAC/M4B with chapter metadata (and optional cover).
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
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
  await run("ffmpeg", args);

  // Cleanup
  try {
    statSync(merged) && (await run("rm", ["-f", merged, metaPath]));
  } catch {
    // best effort
  }
}

function buildFfMetadata(params: {
  title: string;
  artist: string;
  shortCode?: string;
  series?: string;
  chapters: Array<{ title: string; durationMs: number }>;
}): string {
  const lines: string[] = [";FFMETADATA1"];
  lines.push(`title=${params.title}`);
  lines.push(`artist=${params.artist}`);
  lines.push(`album=${params.title}`);
  lines.push(`genre=Audiobook`);
  if (params.shortCode && params.shortCode.trim().length > 0) {
    const s = params.shortCode.trim();
    // Triple-Mapping für maximale Player-Kompatibilität:
    //   - `subtitle` → iTunes/Apple-Books + Audiobookshelf lesen das
    //     als Untertitel des Hörbuchs (primäre Audiobookshelf-Semantik)
    //   - `grouping` → iTunes-Grouping-Spalte, von vielen Tag-Editoren
    //     genutzt
    //   - `comment` → Fallback für Player die weder subtitle noch
    //     grouping anzeigen
    lines.push(`subtitle=${s}`);
    lines.push(`grouping=${s}`);
    lines.push(`comment=${s}`);
  }
  if (params.series && params.series.trim().length > 0) {
    // Audiobookshelf liest den `series`-Tag per ffprobe (case-
    // insensitive). Der dokumentierte Fallback `mvnm` wird von
    // ffprobe nicht zuverlässig extrahiert — also lassen wir den weg.
    lines.push(`series=${params.series.trim()}`);
  }
  let start = 0;
  for (const ch of params.chapters) {
    const end = start + ch.durationMs;
    lines.push("");
    lines.push("[CHAPTER]");
    lines.push("TIMEBASE=1/1000");
    lines.push(`START=${start}`);
    lines.push(`END=${end}`);
    lines.push(`title=${ch.title.replace(/\n/g, " ")}`);
    start = end;
  }
  return lines.join("\n") + "\n";
}
