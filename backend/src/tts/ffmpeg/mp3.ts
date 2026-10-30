// MP3: Tempo, Verbinden, Normalisieren, Dauer
import { writeFileSync } from "fs";
import { join, dirname, basename } from "path";
import { run } from "./run";

// Tempo per atempo ändern, Tonhöhe bleibt
// Erlaubt 0.5 bis 2.0, unser Bereich liegt bei 0.7 bis 1.3
// factor 1: nur kopieren, kein Neu-Encoding
export async function applyAtempo(
  inPath: string,
  outPath: string,
  factor: number
): Promise<void> {
  if (Math.abs(factor - 1.0) < 1e-3) {
    // Faktor 1: kopieren
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
  // Vorwärts-Slashes: ffmpeg versteht sie auch unter Windows
  const content = inputs
    .map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
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

// Wie concatMp3, mit Stille zwischen den Teilen und am Ende
// Qwen ignoriert Absätze, die Pause ersetzt sie
// Stille mit Sample-Rate der ersten Datei: Stream-Copy ohne Codec-Konflikt
export async function concatMp3WithGaps(
  inputs: string[],
  output: string,
  opts: { interChunkMs?: number; trailingMs?: number; leadingMs?: number } = {}
): Promise<void> {
  if (inputs.length === 0) {
    throw new Error("concatMp3WithGaps: inputs is empty");
  }
  const interMs = Math.max(0, opts.interChunkMs ?? 0);
  const trailMs = Math.max(0, opts.trailingMs ?? 0);
  const leadMs = Math.max(0, opts.leadingMs ?? 0);

  if (interMs === 0 && trailMs === 0 && leadMs === 0) {
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
  if (leadMs > 0) seq.push(await ensureSilence(leadMs));
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

export async function probeSampleRate(file: string): Promise<number | null> {
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

// Loudnorm auf -16 LUFS, 128 kbps MP3 mit ID3-Tags; liefert Dauer in ms
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
