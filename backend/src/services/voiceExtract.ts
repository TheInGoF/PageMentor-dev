// Stimm-Extraktor: Video (oder Audio) ablegen, Wellenform für einen Zeitbereich liefern und einen Ausschnitt als WAV
// schneiden, mit 0,5 s Stille davor und danach. Quelldateien liegen nur vorübergehend im Datenordner
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { DATA_DIR } from "../paths";
import { toolPath } from "../tools";
import { probeDurationMs } from "../tts/ffmpeg";

const DIR = join(DATA_DIR, "tmp", "voice-extract");
const KEEP_MS = 24 * 3600_000;
export const PAD_SEC = 0.5;
const SAMPLE_RATE = 24000;

function sourcePath(id: string): string | null {
  if (!/^[0-9a-f-]{36}$/.test(id) || !existsSync(DIR)) return null;
  const f = readdirSync(DIR).find((n) => n.startsWith(`${id}.`));
  return f ? join(DIR, f) : null;
}

// Alte Quellen wegräumen (Videos sind groß)
function cleanup(): void {
  if (!existsSync(DIR)) return;
  for (const n of readdirSync(DIR)) {
    const p = join(DIR, n);
    try {
      if (Date.now() - statSync(p).mtimeMs > KEEP_MS) rmSync(p, { force: true });
    } catch {
      // nächste Runde
    }
  }
}

// Hochgeladene Datei als Strom auf die Platte, ohne sie ganz in den Speicher zu laden
export async function saveSource(body: ReadableStream<Uint8Array> | Blob, filename: string): Promise<{ id: string; durationSec: number }> {
  cleanup();
  mkdirSync(DIR, { recursive: true });
  const id = randomUUID();
  const ext = (extname(filename).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) ?? [".bin"])[0];
  const path = join(DIR, `${id}${ext}`);
  if (body instanceof Blob) await Bun.write(path, body);
  else await Bun.write(path, new Response(body));
  const ms = await probeDurationMs(path).catch(() => 0);
  if (!ms) {
    rmSync(path, { force: true });
    throw new Error("Datei hat keine lesbare Tonspur");
  }
  return { id, durationSec: ms / 1000 };
}

export function dropSource(id: string): void {
  const p = sourcePath(id);
  if (p) rmSync(p, { force: true });
}

function ffmpegBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(toolPath("ffmpeg"), args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}: ${err.trim().split("\n").pop()}`))));
  });
}

// Höchster Ausschlag je Abschnitt aus 16-Bit-PCM (0..1)
export function peaksFromPcm(pcm: Buffer, bins: number): number[] {
  const samples = Math.floor(pcm.length / 2);
  const out = new Array<number>(bins).fill(0);
  if (!samples) return out;
  for (let b = 0; b < bins; b++) {
    const from = Math.floor((b * samples) / bins), to = Math.max(from + 1, Math.floor(((b + 1) * samples) / bins));
    let max = 0;
    for (let i = from; i < to && i < samples; i++) max = Math.max(max, Math.abs(pcm.readInt16LE(i * 2)));
    out[b] = Math.round((max / 32768) * 1000) / 1000;
  }
  return out;
}

// Wellenform für [from, to] in so vielen Balken; die Abtastrate passt sich an, damit lange Videos schnell bleiben
export async function peaks(id: string, from: number, to: number, bins: number): Promise<number[]> {
  const src = sourcePath(id);
  if (!src) throw new Error("Quelle nicht mehr vorhanden");
  const dur = Math.max(0.01, to - from);
  const n = Math.min(4000, Math.max(50, Math.round(bins)));
  const rate = Math.min(16000, Math.max(400, Math.round((n * 100) / dur)));
  const pcm = await ffmpegBuffer(["-hide_banner", "-loglevel", "error", "-ss", from.toFixed(3), "-t", dur.toFixed(3), "-i", src, "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"]);
  return peaksFromPcm(pcm, n);
}

// ffmpeg-Argumente für den Schnitt: genauer Start (Dekodieren ab -ss), Mono 24 kHz, Stille davor und danach
export function cutArgs(src: string, start: number, end: number, out: string): string[] {
  const ms = Math.round(PAD_SEC * 1000);
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", start.toFixed(3), "-t", (end - start).toFixed(3), "-i", src,
    "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE),
    "-af", `adelay=${ms}:all=1,apad=pad_dur=${PAD_SEC}`,
    // Schlichter WAV-Kopf ohne LIST-Block: manche TTS-Engines lesen nur den Standardkopf
    "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
    "-c:a", "pcm_s16le", out,
  ];
}

export async function cut(id: string, start: number, end: number): Promise<Buffer> {
  const src = sourcePath(id);
  if (!src) throw new Error("Quelle nicht mehr vorhanden");
  if (!(end > start) || start < 0) throw new Error("Ungültiger Bereich");
  if (end - start > 300) throw new Error("Höchstens 5 Minuten am Stück");
  const out = join(DIR, `${id}-cut-${Date.now()}.wav`);
  try {
    await ffmpegBuffer(cutArgs(src, start, end, out));
    return Buffer.from(await Bun.file(out).arrayBuffer());
  } finally {
    rmSync(out, { force: true });
  }
}
