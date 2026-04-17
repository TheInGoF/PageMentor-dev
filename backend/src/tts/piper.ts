/**
 * Piper-Wrapper: spawnt das `piper`-Binary, füttert Text über stdin,
 * erhält 22 kHz Mono-WAV an stdout. Die Binary liegt im Image unter
 * PM_PIPER_BIN (Default /opt/piper/piper), Voice-Modelle unter
 * PM_PIPER_DIR (Default /app/piper-voices).
 *
 * Piper kennt kein SSML — Eingabe ist Plain Text. Satzpausen ergeben
 * sich aus Interpunktion und Zeilenumbrüchen.
 */

import { spawn } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, basename } from "path";
import { once } from "events";

const PIPER_BIN = process.env.PM_PIPER_BIN || "/opt/piper/piper";
const PIPER_DIR = process.env.PM_PIPER_DIR || "/app/piper-voices";
const PIPER_LIB = process.env.LD_LIBRARY_PATH || "/opt/piper";

export interface PiperVoiceInfo {
  voiceId: string;        // z. B. "de_DE-thorsten-high"
  modelPath: string;      // absolute path zu .onnx
  configPath: string;     // absolute path zu .onnx.json
  language: string;       // "de", "en"
  locale: string;         // "de_DE", "en_US"
  sampleRate: number;     // aus config, typ. 22050
  quality: string;        // "low" | "medium" | "high" | "x_low"
  speakerCount: number;
}

let cache: PiperVoiceInfo[] | null = null;

export function isPiperAvailable(): boolean {
  return existsSync(PIPER_BIN) && existsSync(PIPER_DIR);
}

/** Liest alle *.onnx-Modelle aus PM_PIPER_DIR und baut eine Voice-Liste. */
export function listPiperVoices(): PiperVoiceInfo[] {
  if (cache) return cache;
  if (!isPiperAvailable()) {
    cache = [];
    return cache;
  }
  const out: PiperVoiceInfo[] = [];
  for (const entry of readdirSync(PIPER_DIR)) {
    if (!entry.endsWith(".onnx")) continue;
    const modelPath = join(PIPER_DIR, entry);
    const configPath = `${modelPath}.json`;
    if (!existsSync(configPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(configPath, "utf8")) as {
        audio?: { sample_rate?: number };
        espeak?: { voice?: string };
        language?: { code?: string; family?: string };
        num_speakers?: number;
      };
      const voiceId = basename(entry, ".onnx");
      const parts = voiceId.split("-");
      const localeHint = parts[0] ?? meta.language?.code ?? "";
      const quality = parts[parts.length - 1] ?? "medium";
      const language =
        meta.language?.family ??
        (localeHint.includes("_") ? localeHint.split("_")[0] : localeHint);
      const locale = localeHint.includes("_")
        ? localeHint
        : meta.language?.code ?? localeHint;
      out.push({
        voiceId,
        modelPath,
        configPath,
        language: language || "",
        locale: locale || language || "",
        sampleRate: meta.audio?.sample_rate ?? 22050,
        quality,
        speakerCount: meta.num_speakers ?? 1,
      });
    } catch {
      // Defektes Manifest ignorieren, sonst blockiert ein einzelnes File alles.
    }
  }
  cache = out.sort((a, b) => a.voiceId.localeCompare(b.voiceId));
  return cache;
}

export function findPiperVoice(voiceId: string): PiperVoiceInfo | undefined {
  return listPiperVoices().find((v) => v.voiceId === voiceId);
}

/** Synthesiert Plain-Text zu einer WAV-Datei an `outPath`. */
export async function synthesizeTextToWav(params: {
  text: string;
  voiceId: string;
  outPath: string;
}): Promise<{ path: string; bytes: number }> {
  const voice = findPiperVoice(params.voiceId);
  if (!voice) throw new Error(`Unknown Piper voice: ${params.voiceId}`);

  const args = [
    "--model", voice.modelPath,
    "--config", voice.configPath,
    "--output_file", params.outPath,
  ];

  const child = spawn(PIPER_BIN, args, {
    env: { ...process.env, LD_LIBRARY_PATH: PIPER_LIB },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
  // Wir lesen stdout nicht explizit — Piper schreibt die WAV-Datei direkt
  // an --output_file. stdout bleibt leer, muss aber abgeführt werden damit
  // der Prozess nicht blockiert.
  child.stdout.resume();

  child.stdin.write(params.text);
  child.stdin.end();

  const [code] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  if (code !== 0) {
    const err = Buffer.concat(stderrChunks).toString("utf8").trim();
    throw new Error(`piper exited with code ${code}: ${err || "(no stderr)"}`);
  }

  const stat = statSync(params.outPath);
  if (stat.size === 0) {
    throw new Error(`Piper produced empty WAV for voice=${params.voiceId}`);
  }
  return { path: params.outPath, bytes: stat.size };
}

/** Einmaliges Preview → liefert MP3-Buffer. */
export async function synthesizePiperPreview(params: {
  voiceId: string;
  text: string;
}): Promise<Buffer> {
  const { mkdtempSync, rmSync, readFileSync } = await import("fs");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "piper-prev-"));
  const wav = join(dir, "prev.wav");
  const mp3 = join(dir, "prev.mp3");
  try {
    await synthesizeTextToWav({ text: params.text, voiceId: params.voiceId, outPath: wav });
    await wavToMp3(wav, mp3);
    return readFileSync(mp3);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

/** WAV → MP3 via ffmpeg. 96 kbit CBR, mono — analog Edge-Pipeline. */
export async function wavToMp3(inputWav: string, outputMp3: string): Promise<void> {
  const ff = spawn("ffmpeg", [
    "-y",
    "-i", inputWav,
    "-ac", "1",
    "-ar", "24000",
    "-b:a", "96k",
    "-codec:a", "libmp3lame",
    outputMp3,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const errChunks: Buffer[] = [];
  ff.stderr.on("data", (c: Buffer) => errChunks.push(c));
  const [code] = (await once(ff, "exit")) as [number | null, NodeJS.Signals | null];
  if (code !== 0) {
    throw new Error(`ffmpeg WAV→MP3 exited ${code}: ${Buffer.concat(errChunks).toString("utf8").trim()}`);
  }
}
