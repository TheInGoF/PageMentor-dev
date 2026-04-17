/**
 * Engine-Dispatcher. Routet jeden Chunk zur passenden Engine und
 * führt Retries mit Backoff aus — bewusst *ohne* stummen Fallback auf
 * eine andere Engine. Wenn Edge wegen Rate-Limit dauerhaft 0 Bytes
 * liefert, soll der User das Kapitel rot blinken sehen und selbst
 * entscheiden, ob er eine andere Stimme wählt.
 *
 * Strategie:
 *   - Pro Chunk bis zu 2 Retries mit 400 ms / 800 ms Backoff.
 *   - Edge-Chunks kriegen zusätzlich 150 ms Inter-Chunk-Pause, damit
 *     Microsofts Anti-Abuse-Gate nicht bei Schlag 20 kippt.
 *   - Bei endgültigem Fail: `ChunkSynthesisFailure` nach oben.
 */

import { setTimeout as sleep } from "timers/promises";
import { findVoice, engineFor } from "./voices";
import type { Segment } from "./segment";
import type { Voice } from "./engines/base";

/** Edge-spezifischer Backoff zwischen Chunks, um Microsofts
 *  Anti-Abuse-Gate nicht zu triggern. Piper hat kein Rate-Limit. */
const EDGE_INTER_CHUNK_DELAY_MS = 500;
/** Längerer Cooldown wenn Edge stumm 0 Bytes geliefert hat — das ist
 *  Microsofts Rate-Limit-Signatur, ein einfacher Retry bringt nichts. */
const EDGE_EMPTY_AUDIO_COOLDOWN_MS = 5000;
const MAX_RETRIES = 2;

export interface ChunkSynthesisParams {
  segment: Segment;
  text: string;
  voice: Voice;
  locale: string;
  rate: string;
  announce?: string;
  outPath: string;
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
): Promise<{ path: string; bytes: number; engineId: "piper" | "edge" }> {
  const engine = engineFor(params.voice.engine);
  if (!engine) throw new Error(`Unknown TTS engine: ${params.voice.engine}`);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
        await sleep(backoff);
      }
    }
  }
  throw new ChunkSynthesisFailure(params.voice.id, lastErr);
}

/** Engine-aware Inter-Chunk-Pause. Nur Edge braucht sie. */
export async function interChunkPause(engineId: "piper" | "edge"): Promise<void> {
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

