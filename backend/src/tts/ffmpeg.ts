import { spawn } from "child_process";
import { writeFileSync, statSync, existsSync } from "fs";
import { join, dirname, basename } from "path";

/**
 * Thin ffmpeg/ffprobe wrapper. Assumes ffmpeg is on the PATH
 * (in the Docker image via apk add ffmpeg; locally via brew install ffmpeg).
 */

export async function run(
  bin: string,
  args: string[],
  opts?: {
    liveStderr?: boolean;
    logPrefix?: string;
    /** Called for each whole stderr line. ffmpeg emits progress
     *  as `\r`-separated single lines — we split on both `\r` and
     *  `\n` so the callback sees each line individually even
     *  during live progress. */
    onStderrLine?: (line: string) => void;
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    const prefix = opts?.logPrefix ?? `[${bin}]`;
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => {
      const chunk = b.toString();
      stderr += chunk;
      const lines = chunk
        .split(/[\r\n]+/)
        .filter((l: string) => l.trim().length > 0);
      for (const line of lines) {
        if (opts?.liveStderr) console.log(`${prefix} ${line}`);
        opts?.onStderrLine?.(line);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Concat MP3 files with identical encoding (stream copy). */
/**
 * Changes playback tempo of an MP3 file via ffmpeg's `atempo`
 * filter, without shifting pitch.
 *
 * `atempo` only accepts 0.5 ≤ f ≤ 2.0. For values outside we'd
 * have to chain (atempo=2.0,atempo=2.0 for 4×), but our Edge rate
 * format "+/-30%" sits in the [0.7, 1.3] range anyway — safe.
 *
 * `factor > 1` = faster (audio gets shorter), `< 1` = slower.
 * `factor === 1` is an opt-out and does a file-copy trick instead
 * of re-encode (saves quality loss).
 */
export async function applyAtempo(
  inPath: string,
  outPath: string,
  factor: number
): Promise<void> {
  if (Math.abs(factor - 1.0) < 1e-3) {
    // Identity — just copy (or rename if that's OK).
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
 * Concat like `concatMp3`, but with silence pads between inputs
 * (`interChunkMs`) and/or at the end (`trailingMs`).
 *
 * Purpose: Qwen3-TTS-Base ignores `\n\n` and rattles through
 * paragraph boundaries. Short pause between chunks = thinking
 * pause between paragraphs. Trailing pause at chapter end =
 * paragraph before the next chapter or before M4B concatenation.
 *
 * Silence MP3 is generated at the sample rate of the first input so
 * the stream-copy concat runs without codec mismatch.
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
 * Loudnorm (EBU R128 → podcast standard -16 LUFS) + re-encode to
 * 128kbps MP3 with ID3 tags. Returns the runtime in milliseconds.
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
 * Builds an M4B (AAC in MP4) with chapter markers + metadata + cover.
 * `chapters` is passed to ffmpeg as an FFMETADATA file.
 *
 * Metadata layout:
 * - title  = doc title (what the user sees in the UI)
 * - artist = author from PDF metadata (or "PageMentor" fallback)
 * - album  = title (iTunes groups M4B audiobooks by album)
 * - grouping = shortCode (user shortcode, e.g. "SE12k" / "1" / "2")
 * - genre  = Audiobook
 */
export async function buildM4B(params: {
  inputs: string[];
  chapters: Array<{ title: string; durationMs: number }>;
  output: string;
  title: string;
  artist?: string;
  shortCode?: string;
  /** Series name (e.g. module name). Lands as the `series` metadata
   *  tag — that's the primary tag Audiobookshelf reads via ffprobe.
   *  `mvnm` would be the documented fallback, but ffprobe doesn't
   *  extract it reliably, so we skip it. */
  series?: string;
  /** Sequence-Position innerhalb der Serie (z.B. "1" fuer das erste
   *  Heft eines Studiengangs). Wird als track + movement_index in
   *  den M4B geschrieben (beide ueberleben ffmpeg). ABS liest's via
   *  ffprobe als format.tags.track / format.tags.movement. */
  seriesSequence?: string;
  coverPath?: string;
  /** Optional: progress callback during the ffmpeg encode.
   *  `currentMs` = current audio position per ffmpeg, `totalMs` =
   *  total duration of the merged MP3 per ffprobe. Called per
   *  stderr line with `time=...` (on average 1-2× per second). */
  onProgress?: (currentMs: number, totalMs: number) => void;
}): Promise<void> {
  const buildStart = Date.now();
  // Clean up stale intermediates from a previous aborted build,
  // otherwise we get inconsistencies (broken M4B next to a 120 MB
  // merged.mp3, no way for the user to recover). Also kill the
  // target M4B in case it was left truncated.
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

  // 1. Concat inputs to a single MP3 first (stream copy).
  const concatStart = Date.now();
  await concatMp3(params.inputs, merged);
  const mergedSize = existsSync(merged) ? statSync(merged).size : 0;
  console.log(
    `[m4b] concat ${params.inputs.length} chunks → ${merged} (${(mergedSize / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - concatStart) / 1000).toFixed(1)}s`
  );

  // 2. Build FFMETADATA with chapter markers
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

  // 3. Encode to AAC/M4B with chapter metadata (and optional cover).
  // `-loglevel info` + liveStderr: we see one progress line per 5 s
  // ("size=... time=... bitrate=...") in the backend log, so the
  // user gets feedback during long builds AND on failure we
  // immediately see where it broke.
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
  // Probe the total duration once — we need it for progress
  // calculation. ffmpeg itself emits time= as a counter but no
  // total; we compute that ourselves.
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
  // ffmpeg emits many progress lines on stderr even on success — if
  // the M4B is unexpectedly small, the last lines help diagnose
  // (e.g. "moov atom not found" or "Conversion failed!" despite
  // exit 0).
  const tailLines = stderr.trim().split(/\r?\n/).slice(-8).join(" | ");
  if (tailLines) {
    console.log(`[m4b] ffmpeg tail: ${tailLines}`);
  }

  // KNOWN LIMITATION: ffmpeg's MP4-Muxer kann den iTunes ©st3-
  // Subtitle-Atom physisch nicht schreiben (kennt ihn nicht in seiner
  // Atom-Whitelist). mp4v2-utils (provides mp4tags) wurde in Debian 12
  // entfernt. AtomicParsley hat keinen direkten --subtitle Flag.
  // Konsequenz: Subtitle wird NUR via ABS-PATCH-Endpoint gesetzt, ist
  // aber nach einem ABS-Library-Rescan wieder leer (ABS liest die
  // File-Tags und sieht kein subtitle → ueberschreibt DB-Wert nicht
  // mit leer, behaelt also unseren PATCH-Wert solange kein Force-
  // Rescan kommt).
  // Empfehlung fuers User-Setup: in ABS Library Settings "Force
  // re-scan" vermeiden, oder Subtitle nach jedem Re-Scan via API
  // neu setzen (manuell oder via Re-Upload aus PageMentor).
  // Kuenftige Loesung: Bun-natives MP4-Box-Writer-Modul integrieren.

  // Apple-Books-Atome via AtomicParsley nachziehen — ffmpeg's MP4-
  // Muxer schreibt `stik` (iTunes media type) und `pgap` (gapless)
  // nicht zuverlaessig. Apple Books erkennt eine M4B nur dann als
  // Audiobook, wenn `stik=2` gesetzt ist (sonst wird sie als Music
  // einsortiert oder gar nicht importiert). AtomicParsley ist das
  // Standard-Tool fuer iTunes-Atome und exit-codet sauber wenn die
  // Datei nicht beschrieben werden kann.
  await applyAppleBooksAtoms(params.output);

  // Cleanup — using fs.unlink instead of shell rm (fewer moving parts).
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


/**
 * Sets the iTunes-specific MP4 atoms that Apple Books needs to
 * recognize the file as an audiobook:
 *   - stik=2 (Audiobook media type)
 *   - pgap=true (gapless playback between chapters)
 *
 * AtomicParsley overwrites the file in place (`--overWrite`). If the
 * binary is missing or the call fails, we log a warning and continue —
 * the M4B is still valid for everything except Apple Books, so the
 * pipeline shouldn't hard-fail on this. Audiobookshelf, VLC, ffmpeg,
 * Plex etc. don't depend on `stik`.
 */
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
    // AtomicParsley sometimes leaves a temp file like
    // `name-temp-XXXX.m4b` if --overWrite couldn't replace in place
    // (e.g. permissions). Verify size delta is reasonable.
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

/** FFMETADATA1 requires `\`, `=`, `;`, `#` and newlines in values to
 *  be backslash-escaped — an unescaped newline or trailing backslash
 *  in a PDF-derived title corrupts the file (chapters vanish or the
 *  M4B build fails). */
function ffMetaEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/=/g, "\\=")
    .replace(/;/g, "\\;")
    .replace(/#/g, "\\#")
    .replace(/\r?\n/g, " ");
}

function buildFfMetadata(params: {
  title: string;
  artist: string;
  shortCode?: string;
  series?: string;
  seriesSequence?: string;
  chapters: Array<{ title: string; durationMs: number }>;
}): string {
  // Mapping reality with ffmpeg/MP4 + Audiobookshelf:
  //
  //   PageMentor-Begriff   →   M4B-Atom   →   ABS-Field
  //   Buch-Titel (PDF)         ©nam            book.title
  //   Modul-Name               ©mvn (movement)  series.name
  //                            tvsh (show)      series.name (fallback)
  //   Untertitel (shortCode)   ©st3 (NICHT von ffmpeg) → nur via PATCH
  //   Series-Position          trkn / ©mvi      series.sequence
  //
  // FRUEHER (v1.18.131-): album=seriesName. Das war falsch — ABS in
  // Audiobook-Mode liest album als Buch-Titel und ueberschrieb damit
  // den korrekten title-Tag. Konsequenz: User sah Modul-Name als
  // Buch-Titel statt PDF-Titel. JETZT: kein album-Tag mehr,
  // movement_name + show tragen die Series-Info, title bleibt sauber.
  const lines: string[] = [";FFMETADATA1"];
  lines.push(`title=${ffMetaEscape(params.title)}`);
  lines.push(`artist=${ffMetaEscape(params.artist)}`);
  // Audiobookshelf takes artist as author, but album_artist is the
  // more official path — belt and suspenders.
  lines.push(`album_artist=${ffMetaEscape(params.artist)}`);
  // album = title (Buch-Titel), NICHT series. Andere Player ohne
  // Audiobook-Mode zeigen oft album als Haupt-Label — dann ist
  // book-title als album besser als series-name als album.
  lines.push(`album=${ffMetaEscape(params.title)}`);
  const seriesName = params.series?.trim();
  if (seriesName && seriesName.length > 0) {
    // movement_name + show als echte Series-Carrier. ABS liest beide
    // als series.name (mvnm und show sind in der Series-Detection-
    // Liste). Album bleibt Buch-Titel.
    lines.push(`movement_name=${ffMetaEscape(seriesName)}`);
    lines.push(`show=${ffMetaEscape(seriesName)}`);
  }
  // No series/module name → album bleibt Buch-Titel, movement/show leer.
  lines.push(`genre=Audiobook`);
  if (params.shortCode && params.shortCode.trim().length > 0) {
    // Only `grouping` — that's a real iTunes atom (©grp) and is
    // guaranteed to survive the muxer. We previously also wrote
    // `comment`, but ABS reads that as description (semantically
    // wrong for a shortcode). `subtitle` is not an MP4-standard
    // atom and ffmpeg discards it — so we skip it.
    lines.push(`grouping=${ffMetaEscape(params.shortCode.trim())}`);
  }
  if (params.seriesSequence && params.seriesSequence.trim().length > 0) {
    // Series-Position als track + movement_index. Beide sind echte
    // iTunes-Atome (trkn / ©mvi) die ffmpeg's Muxer schreibt. ABS
    // liest track als Sequence-Number wenn series gesetzt ist.
    // Numeric only — wenn der User "1.5" / "1a" eingibt, wird der
    // Wert von ffmpeg zu int gecastet bzw weggelassen. Fuer komplexe
    // Sequences greift weiterhin der ABS-PATCH (sequence: "1.5"
    // bleibt erhalten, M4B speichert nur die Integer-Komponente).
    lines.push(`track=${params.seriesSequence.trim()}`);
    lines.push(`movement_index=${params.seriesSequence.trim()}`);
  }
  let start = 0;
  for (const ch of params.chapters) {
    const end = start + ch.durationMs;
    lines.push("");
    lines.push("[CHAPTER]");
    lines.push("TIMEBASE=1/1000");
    lines.push(`START=${start}`);
    lines.push(`END=${end}`);
    lines.push(`title=${ffMetaEscape(ch.title)}`);
    start = end;
  }
  return lines.join("\n") + "\n";
}
