/**
 * Engine dispatcher with retry + backoff. Qwen (local sidecar behind
 * the arbiter) has no rate limits — the arbiter queues per request,
 * no inter-chunk pause. On final failure: `ChunkSynthesisFailure`
 * bubbles up.
 */

import { setTimeout as sleep } from "timers/promises";
import { findVoice, engineFor } from "./voices";
import type { Segment } from "./segment";
import type { EngineId, Voice } from "./engines/base";

// Two retries was the historical default from when chunks were
// 30-60s and a transient hiccup was cheap to redo. With chunks up to
// 4000 chars taking 4-6 minutes on Qwen3-TTS, three attempts can
// silently consume 20+ minutes of GPU time on the same broken chunk.
// One retry is the right balance: covers a real transient drop, but
// fails fast when the chunk genuinely doesn't work.
const MAX_RETRIES = 1;

interface EnginePolicy {
  /** Pause between consecutive chunks. */
  interChunkDelayMs: number;
  /** Cooldown after an empty-audio error. */
  emptyAudioCooldownMs: number;
}

const POLICIES: Record<EngineId, EnginePolicy> = {
  // Qwen runs on the same GPU as Ollama — the arbiter queues per
  // request, an additional inter-chunk pause buys nothing.
  qwen: { interChunkDelayMs: 0, emptyAudioCooldownMs: 0 },
};

export interface ChunkSynthesisParams {
  segment: Segment;
  text: string;
  voice: Voice;
  locale: string;
  rate: string;
  announce?: string;
  outPath: string;
  /** Optional AbortSignal — when the user cancels mid-flight, the
   *  backoff sleep aborts immediately instead of waiting out 30 s. */
  signal?: AbortSignal;
}

export class ChunkSynthesisFailure extends Error {
  constructor(public voiceId: string, public cause: unknown) {
    super(
      `Chunk synthesis failed for voice=${voiceId}: ${String(
        (cause as Error)?.message ?? cause
      )}`
    );
  }
}

/**
 * Synthesizes a chunk via the engine matching the voice. Performs
 * retries with backoff. Throws `ChunkSynthesisFailure` when all
 * attempts fail.
 */
export async function synthesizeChunk(
  params: ChunkSynthesisParams
): Promise<{ path: string; bytes: number; engineId: EngineId }> {
  const engine = engineFor(params.voice.engine);
  if (!engine) throw new Error(`Unknown TTS engine: ${params.voice.engine}`);
  const policy = POLICIES[engine.id];

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
      const cause = err instanceof Error ? err.message : String(err);
      console.warn(
        `[tts] chunk synthesis attempt ${attempt + 1}/${MAX_RETRIES + 1} ` +
          `failed for voice=${params.voice.id} engine=${engine.id}: ${cause}`
      );
      if (attempt < MAX_RETRIES) {
        const isEmptyAudio =
          err instanceof Error && /empty audio/i.test(err.message);
        const backoff =
          isEmptyAudio && policy.emptyAudioCooldownMs > 0
            ? policy.emptyAudioCooldownMs
            : 400 * Math.pow(2, attempt);
        console.warn(
          `[tts] retrying chunk in ${backoff}ms ` +
            `(reason=${isEmptyAudio ? "empty-audio" : "exception"})`
        );
        try {
          await sleep(backoff, undefined, { signal: params.signal });
        } catch {
          throw new ChunkSynthesisFailure(
            params.voice.id,
            new Error("canceled")
          );
        }
      }
    }
  }
  throw new ChunkSynthesisFailure(params.voice.id, lastErr);
}

/** Inter-chunk pause to avoid rate limits. Configured per engine
 *  — Qwen = 0 ms, Edge = 1500 ms. */
export async function interChunkPause(engineId: EngineId): Promise<void> {
  const ms = POLICIES[engineId]?.interChunkDelayMs ?? 0;
  if (ms > 0) await sleep(ms);
}

/** Preview → Buffer. No retries/fallbacks — if the engine doesn't
 *  respond, the user sees it immediately. */
export async function synthesizePreview(params: {
  voice: string;
  locale: string;
  text: string;
  /** Override for the Qwen instruction (preset voices). Lets the
   *  settings tester try unsaved instruction text. */
  instructOverride?: string;
  /** Advanced dial overrides — analogous to instructOverride. */
  temperatureOverride?: number;
  topPOverride?: number;
  topKOverride?: number;
  repetitionPenaltyOverride?: number;
}): Promise<Buffer> {
  const voice = findVoice(params.voice);
  if (!voice) throw new Error(`Unknown voice: ${params.voice}`);
  const engine = engineFor(voice.engine);
  if (!engine) throw new Error(`Unknown TTS engine: ${voice.engine}`);
  return engine.preview({
    voice,
    locale: params.locale,
    text: params.text,
    instructOverride: params.instructOverride,
    temperatureOverride: params.temperatureOverride,
    topPOverride: params.topPOverride,
    topKOverride: params.topKOverride,
    repetitionPenaltyOverride: params.repetitionPenaltyOverride,
  });
}
