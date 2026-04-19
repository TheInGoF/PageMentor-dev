/**
 * Engine-Dispatcher mit pro-Engine Retry- und Pace-Strategie.
 *
 * Qwen (lokaler Sidecar hinter dem Arbiter) hat keine Rate-Limits —
 * der Arbiter queued pro Request, keine Inter-Chunk-Pause nötig.
 * Edge (Microsoft Cloud) braucht 1.5 s Pause zwischen Chunks und
 * einen 30 s Cooldown nach Empty-Audio (Azure-Quota), weil kurze
 * Backoffs nichts bringen.
 *
 * Bei endgültigem Fail: `ChunkSynthesisFailure` nach oben — der
 * Caller kann das als Signal interpretieren, das Buch abzubrechen
 * oder auf einen anderen Provider auszuweichen.
 */

import { setTimeout as sleep } from "timers/promises";
import { findVoice, engineFor } from "./voices";
import type { Segment } from "./segment";
import type { EngineId, Voice } from "./engines/base";

const MAX_RETRIES = 2;

interface EnginePolicy {
  /** Pause zwischen aufeinanderfolgenden Chunks. */
  interChunkDelayMs: number;
  /** Cooldown nach Empty-Audio-Fehler — 0 deaktiviert die Spezialregel
   *  (nur Edge braucht das). */
  emptyAudioCooldownMs: number;
}

const POLICIES: Record<EngineId, EnginePolicy> = {
  edge: { interChunkDelayMs: 1500, emptyAudioCooldownMs: 30_000 },
  // Qwen läuft auf derselben GPU wie Ollama — der Arbiter queued pro
  // Request, zusätzliche Inter-Chunk-Pause bringt nichts.
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
  /** Optional AbortSignal — wenn der User mittendrin Cancel drückt,
   *  bricht der Backoff-Sleep sofort ab statt 30 s abzuwarten. */
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
 * Synthesisiert einen Chunk über die für die Voice passende Engine.
 * Führt Retries mit Backoff aus. Wirft `ChunkSynthesisFailure` wenn
 * alle Versuche scheitern.
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
      if (attempt < MAX_RETRIES) {
        const isEmptyAudio =
          err instanceof Error && /empty audio/i.test(err.message);
        const backoff =
          isEmptyAudio && policy.emptyAudioCooldownMs > 0
            ? policy.emptyAudioCooldownMs
            : 400 * Math.pow(2, attempt);
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

/** Inter-Chunk-Pause zur Rate-Limit-Vermeidung. Pro Engine konfiguriert
 *  — Qwen = 0 ms, Edge = 1500 ms. */
export async function interChunkPause(engineId: EngineId): Promise<void> {
  const ms = POLICIES[engineId]?.interChunkDelayMs ?? 0;
  if (ms > 0) await sleep(ms);
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
