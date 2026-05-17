/**
 * Process-wide serialisation for Gemma calls.
 *
 * Originally lived in `audioPreprocess.ts` (v1.18.148), but we need
 * the same queue across every callsite that runs Gemma:
 *
 *   - Audio chapter preprocessing
 *   - Card chapter preprocessing (classify + Q&A extract / content rewrite)
 *   - Any future "let Gemma look at this chapter" feature
 *
 * Without a SHARED queue, two services would have separate locks and
 * still hit Ollama in parallel — which is exactly what burned the user
 * when 5 card-preprocess STARTs went out within 5 seconds and shoved
 * the GPU arbiter into a flapping state.
 *
 * Why a module-level queue: Gemma3:e4b saturates a single 3090 with
 * one inference pass — running two preprocess calls in parallel does
 * NOT shorten total wall time (40s+40s ≈ 80s parallel = 80s
 * sequential), it just splits the GPU's attention and degrades
 * instruction-following at num_ctx=65536. Cache-hits don't go through
 * this queue (callers handle them before invoking).
 */

let gemmaQueue: Promise<unknown> = Promise.resolve();
let gemmaQueueDepth = 0;

export function withGemmaLock<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  gemmaQueueDepth++;
  const ticket = gemmaQueueDepth;
  if (ticket > 1) {
    console.log(
      `[gemma-lock] ${label} waiting in queue (position ${ticket - 1})`
    );
  } else {
    console.log(`[gemma-lock] ${label} acquiring lock`);
  }
  const wrapped = async () => {
    console.log(`[gemma-lock] ${label} lock acquired, calling LLM`);
    try {
      return await fn();
    } finally {
      console.log(`[gemma-lock] ${label} releasing lock`);
    }
  };
  const next = gemmaQueue.then(wrapped, wrapped);
  // Don't let one rejection poison the chain — the next caller should
  // still get a clean slot. We swallow the error here; the original
  // promise (`next`) still rejects to its own caller.
  gemmaQueue = next
    .catch(() => undefined)
    .finally(() => {
      gemmaQueueDepth--;
    });
  return next;
}

/** Current queue length, for debug/status endpoints. */
export function gemmaQueueLength(): number {
  return gemmaQueueDepth;
}
