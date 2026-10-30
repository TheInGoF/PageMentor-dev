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

// No retries on Qwen3-TTS chunks. Each attempt costs 4-6 minutes of
// GPU time at 4000 chars; a retry on a structurally broken chunk
// burns budget for nothing, and the original failure mode (hidden
// keep-alive idle drop) is now addressed at the fetch layer with
// Connection:close + keepalive:false in qwen.ts. If you want one
// retry back, raise this to 1 — the per-attempt logging stays.
const MAX_RETRIES = 0;

interface EnginePolicy {
  /** Pause between consecutive chunks. */
  interChunkDelayMs: number;
  /** Cooldown after an empty-audio error. */
  emptyAudioCooldownMs: number;
  // Feste Chunk-Größe in Zeichen; fehlt sie, gilt die Einstellung
  maxChunk?: number;
}

const POLICIES: Record<EngineId, EnginePolicy> = {
  // Qwen runs on the same GPU as Ollama — the arbiter queues per
  // request, an additional inter-chunk pause buys nothing.
  qwen: { interChunkDelayMs: 0, emptyAudioCooldownMs: 0 },
  // Kokoro teilt intern nach Phonemen, kurze Chunks halten die Betonung
  kokoro: { interChunkDelayMs: 0, emptyAudioCooldownMs: 0, maxChunk: 1000 },
  // F5: so kurz, dass ein Abschnitt in ein Stück passt (bei ~8 s Referenz rund 250 Zeichen);
  // längere teilt F5 selbst und verschluckt an den Übergängen Silben
  f5: { interChunkDelayMs: 0, emptyAudioCooldownMs: 0, maxChunk: 250 },
  // TADA: ein Absatz bis eine Seite
  tada: { interChunkDelayMs: 0, emptyAudioCooldownMs: 0, maxChunk: 1500 },
};

export function maxChunkFor(engineId: EngineId): number | undefined {
  return POLICIES[engineId]?.maxChunk;
}

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
  // Tracks whether we've already burned the one-shot loop-retry. The
  // sidecar reports `503 loop_detected` when the AR decoder gets stuck
  // in a token loop (issue #258). A retry with the same seed is
  // pointless (deterministic), but a retry with a freshly rolled seed
  // breaks the deterministic loop ~80% of the time per Qwen issue
  // tracker — well worth the one extra attempt. Independent of
  // MAX_RETRIES, so the loop-rescue path stays available even when
  // generic retries are off.
  let loopRetryUsed = false;
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
        signal: params.signal,
      });
      return { ...result, engineId: engine.id };
    } catch (err) {
      lastErr = err;
      const cause = err instanceof Error ? err.message : String(err);
      const isLoopDetected = /loop_detected/i.test(cause);
      console.warn(
        `[tts] chunk synthesis attempt ${attempt + 1}/${MAX_RETRIES + 1} ` +
          `failed for voice=${params.voice.id} engine=${engine.id}: ${cause}`
      );
      // Loop-rescue: side-channel one extra attempt for this specific
      // failure, ignoring MAX_RETRIES. The seed flip happens via
      // engine-specific seed-override (audiobook orchestrator picks
      // a fresh seed when it sees this error).
      if (isLoopDetected && !loopRetryUsed) {
        loopRetryUsed = true;
        console.warn(
          `[tts] loop_detected — one rescue retry; reusing same params, ` +
            `model RNG already advanced so the next sample is different`
        );
        try {
          await sleep(800, undefined, { signal: params.signal });
        } catch {
          throw new ChunkSynthesisFailure(
            params.voice.id,
            new Error("canceled")
          );
        }
        // Re-enter the loop without consuming an attempt.
        attempt -= 1;
        continue;
      }
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
