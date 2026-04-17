import { spawn } from "child_process";
import { writeFileSync, statSync } from "fs";
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
 * Baut ein M4B (AAC in MP4) mit Kapitelmarken.
 * `chapters` wird als FFMETADATA-File an ffmpeg übergeben.
 */
export async function buildM4B(params: {
  inputs: string[];
  chapters: Array<{ title: string; durationMs: number }>;
  output: string;
  title: string;
  artist?: string;
  coverPath?: string;
}): Promise<void> {
  // 1. Concat inputs to a single MP3 first (stream copy).
  const merged = params.output.replace(/\.m4b$/i, ".merged.mp3");
  await concatMp3(params.inputs, merged);

  // 2. Build FFMETADATA with chapter markers
  const metaPath = params.output.replace(/\.m4b$/i, ".ffmeta");
  const meta = buildFfMetadata({
    title: params.title,
    artist: params.artist ?? "PageMentor",
    chapters: params.chapters,
  });
  writeFileSync(metaPath, meta);

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
  if (params.coverPath) args.push("-i", params.coverPath);
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
  if (params.coverPath) {
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
  chapters: Array<{ title: string; durationMs: number }>;
}): string {
  const lines: string[] = [";FFMETADATA1"];
  lines.push(`title=${params.title}`);
  lines.push(`artist=${params.artist}`);
  lines.push(`album=${params.title}`);
  lines.push(`genre=Audiobook`);
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
