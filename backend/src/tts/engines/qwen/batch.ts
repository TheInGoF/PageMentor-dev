// Qwen-Batching: mehrere Abschnitte derselben eigenen Stimme in einem Durchgang. Die Grafikkarte ist beim
// schrittweisen Sprechen nicht ausgelastet; im Batch rechnet sie die Abschnitte parallel. Nur für eigene
// Stimmen (Klon), einstellbar in der Engine-Seite (1 = aus). Fehler: der Aufrufer spricht die Abschnitte einzeln
import { unlink, writeFile } from "fs/promises";
import { getLlmConfig } from "../../../services/llmConfig";
import { recordChunkTiming } from "../../../services/voiceSamples";
import { applyAtempo } from "../../ffmpeg";
import { speakerForPresetId } from "../../presetVoices";
import type { Voice } from "../base";
import { callSpeechCloneBatch } from "./calls";
import { parseRate, readDials, SYNTH_TIMEOUT_MS } from "./config";
import { resolveDesign, resolveSample } from "./voices";

export const QWEN_BATCH_MAX = 4;

// Scheitert ein Durchgang am Sidecar (nicht an einer Schleife), eine Weile einzeln sprechen: sonst kostet
// jeder weitere Versuch die volle Rechenzeit, bevor einzeln nachgesprochen wird
const PAUSE_AFTER_FAIL_MS = 30 * 60_000;
let pausedUntil = 0;

export function qwenBatchSize(): number {
  if (Date.now() < pausedUntil) return 1;
  const n = Number(getLlmConfig().qwenBatch);
  return Number.isInteger(n) && n >= 1 && n <= QWEN_BATCH_MAX ? n : 1;
}

export function canBatch(voice: Voice): boolean {
  return voice.engine === "qwen" && !speakerForPresetId(voice.id) && !resolveDesign(voice.id) && !!resolveSample(voice.id);
}

export async function synthesizeQwenBatch(p: { texts: string[]; voice: Voice; rate: string; outPaths: string[]; signal?: AbortSignal }): Promise<void> {
  const sample = resolveSample(p.voice.id);
  if (!sample) throw new Error(`Qwen-TTS voice sample ${p.voice.id} not found`);
  const t0 = Date.now();
  let bufs: Buffer[];
  try {
    bufs = await callSpeechCloneBatch({ texts: p.texts, sample, timeoutMs: SYNTH_TIMEOUT_MS, dials: readDials(), signal: p.signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!p.signal?.aborted && !/loop_detected/i.test(msg)) {
      pausedUntil = Date.now() + PAUSE_AFTER_FAIL_MS;
      console.warn(`[qwen-tts] Batching für 30 Minuten pausiert: ${msg.slice(0, 160)}`);
    }
    throw err;
  }
  const speed = parseRate(p.rate);
  for (let i = 0; i < bufs.length; i++) {
    if (Math.abs(speed - 1) < 1e-3) {
      await writeFile(p.outPaths[i], bufs[i]);
      continue;
    }
    const raw = `${p.outPaths[i]}.raw.mp3`;
    await writeFile(raw, bufs[i]);
    try {
      await applyAtempo(raw, p.outPaths[i], speed);
    } finally {
      await unlink(raw).catch(() => undefined);
    }
  }
  // Restzeit-Statistik: Zeit je Zeichen über den ganzen Durchgang
  const chars = p.texts.reduce((a, t) => a + t.length, 0);
  try {
    recordChunkTiming(sample.id, chars, Date.now() - t0);
  } catch {
    // Statistik ist Beiwerk
  }
  console.log(`[qwen-tts] batch voice=${p.voice.id} n=${p.texts.length} chars=${chars} took=${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
