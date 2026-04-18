/**
 * Engine-Dispatcher. Edge ist seit v1.11.001 die einzige Engine;
 * Piper wurde entfernt. Der Dispatcher bleibt als dünne Schicht
 * bestehen, damit wir zukünftige Engines (Kokoro, XTTS, …) ohne
 * größere Umbauten dazu-stecken können.
 *
 * Strategie:
 *   - Pro Chunk bis zu 2 Retries mit 400 ms / 800 ms Backoff.
 *   - Edge-Chunks kriegen zusätzlich 1500 ms Inter-Chunk-Pause, damit
 *     Microsofts Anti-Abuse-Gate nicht bei Schlag 20 kippt.
 *   - Empty-Audio-Spezialfall: 30 s Cooldown vor dem Retry, weil kurze
 *     Backoffs gegen Azure-Rate-Limiting nichts bringen.
 *   - Bei endgültigem Fail: `ChunkSynthesisFailure` nach oben.
 */

import { setTimeout as sleep } from "timers/promises";
import { findVoice, engineFor } from "./voices";
import type { Segment } from "./segment";
import type { Voice } from "./engines/base";

const EDGE_INTER_CHUNK_DELAY_MS = 1500;
const EDGE_EMPTY_AUDIO_COOLDOWN_MS = 30_000;
const MAX_RETRIES = 2;

export interface ChunkSynthesisParams {
  segment: Segment;
  text: string;
  voice: Voice;
  locale: string;
  rate: string;
  announce?: string;
  outPath: string;
  /** Optional AbortSignal — wenn der User mittendrin Cancel drückt,
   *  bricht der Backoff-Sleep sofort ab statt 30 s abzuwarten. */
  signal?: AbortSignal;
}

export class ChunkSynthesisFailure extends Error {
  constructor(public voiceId: string, public cause: unknown) {
    super(`Chunk synthesis failed for voice=${voiceId}: ${String((cause as Error)?.message ?? cause)}`);
  }
}

/**
 * Synthesisiert einen Chunk über die für die Voice passende Engine.
 * Führt Retries mit Backoff aus. Wirft `ChunkSynthesisFailure` wenn
 * alle Versuche scheitern — der Caller darf das als Signal zum
 * Engine-Switch interpretieren.
 */
export async function synthesizeChunk(
  params: ChunkSynthesisParams
): Promise<{ path: string; bytes: number; engineId: "edge" }> {
  const engine = engineFor(params.voice.engine);
  if (!engine) throw new Error(`Unknown TTS engine: ${params.voice.engine}`);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (params.signal?.aborted) {
      throw new ChunkSynthesisFailure(params.voice.id, new Error("canceled"));
    }
    try {
      const result = await engine.synthesize({
        segment: params.segment,
        text: params.text,
        voice: params.voice,
        locale: params.locale,
        rate: params.rate,
        announce: params.announce,
        outPath: params.outPath,
      });
      return { ...result, engineId: engine.id };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        // Edge-Empty-Audio ist Rate-Limit — kurzer Backoff bringt nichts.
        const isEdgeEmpty =
          engine.id === "edge" &&
          err instanceof Error &&
          /empty audio/i.test(err.message);
        const backoff = isEdgeEmpty
          ? EDGE_EMPTY_AUDIO_COOLDOWN_MS
          : 400 * Math.pow(2, attempt);
        try {
          await sleep(backoff, undefined, { signal: params.signal });
        } catch {
          // AbortError — Cancel während Backoff → raus ohne weitere Retries
          throw new ChunkSynthesisFailure(params.voice.id, new Error("canceled"));
        }
      }
    }
  }
  throw new ChunkSynthesisFailure(params.voice.id, lastErr);
}

/** Inter-Chunk-Pause zur Rate-Limit-Vermeidung. Derzeit nur Edge. */
export async function interChunkPause(engineId: "edge"): Promise<void> {
  if (engineId === "edge") await sleep(EDGE_INTER_CHUNK_DELAY_MS);
}

/** Preview → Buffer. Keine Retries/Fallbacks — wenn die Engine nicht
 *  antwortet, sieht der User das sofort. */
export async function synthesizePreview(params: {
  voice: string;
  locale: string;
  text: string;
}): Promise<Buffer> {
  const voice = findVoice(params.voice);
  if (!voice) throw new Error(`Unknown voice: ${params.voice}`);
  const engine = engineFor(voice.engine);
  if (!engine) throw new Error(`Unknown TTS engine: ${voice.engine}`);
  return engine.preview({ voice, locale: params.locale, text: params.text });
}

