/**
 * Embedding generation via HuggingFace TEI (Text Embeddings Inference).
 *
 * Single backend by design. We previously had an Ollama fallback for
 * jina-v2-base-de / bge-m3 / nomic-embed-text, but the fallback path
 * could silently mix incompatible vectors into the same DB if TEI was
 * briefly down — different models live in different vector spaces.
 * Better to fail loud and force the operator to fix TEI than to dilute
 * the corpus.
 *
 * TEI must be reachable via `PM_TEI_URL` (or the `teiUrl` setting in
 * the LLM config). It serves jina-embeddings-v3, which has task-
 * specific LoRA adapters: pass `"passage"` when indexing chunks,
 * `"query"` when embedding a search query — that's what makes v3
 * meaningfully better than v2 on German MTEB retrieval.
 *
 * Storage in SQLite as Float32 BLOB. jina-v3 = 1024 dim × 4 bytes =
 * 4 KB / chunk. Brute-force cosine over 10 k chunks is ~100 ms in JS,
 * fine until we move to Qdrant for 100k+ corpora.
 *
 * Switching models or task IDs changes the vector space and makes
 * existing rows incomparable. The DB column `chunks.embedding_model`
 * records what produced each row; the reembed endpoint re-embeds rows
 * that don't match the currently active embedder string.
 */

import { effective } from "./llmConfig";

export type EmbedTask = "passage" | "query";

export interface EmbedderConfig {
  url: string;
  /** Model identifier as stored in `chunks.embedding_model`, prefixed
   *  with `tei:` so it's unambiguous. Example:
   *  `tei:jinaai/jina-embeddings-v3`. */
  model: string;
}

interface TeiInfo {
  modelId: string;
}

async function teiInfo(url: string): Promise<TeiInfo | null> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/info`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { model_id?: string };
    if (!data.model_id) return null;
    return { modelId: data.model_id };
  } catch {
    return null;
  }
}

function teiTaskId(task: EmbedTask): string {
  return task === "query" ? "retrieval.query" : "retrieval.passage";
}

/** Resolves the active embedder. Returns null when TEI is not
 *  configured or unreachable — callers must handle that as a hard
 *  failure (no fallback). */
export async function resolveEmbedder(): Promise<EmbedderConfig | null> {
  const teiUrl = effective("teiUrl", "PM_TEI_URL");
  if (!teiUrl) {
    console.warn(
      "[embeddings] no TEI configured (set teiUrl in settings or PM_TEI_URL env)"
    );
    return null;
  }
  const info = await teiInfo(teiUrl);
  if (!info) {
    console.warn(`[embeddings] TEI at ${teiUrl} unreachable`);
    return null;
  }
  const model = `tei:${info.modelId}`;
  console.log(`[embeddings] using ${model} on ${teiUrl}`);
  return { url: teiUrl, model };
}

/** Embeds a single text. `task` selects the jina-v3 LoRA adapter:
 *   - `"passage"` (default): indexing chunks
 *   - `"query"`: retrieval queries (questions, search inputs)
 *
 *  Always pair `passage` (index time) with `query` (search time);
 *  mixing tasks within a corpus loses the v3 retrieval edge. */
export async function embedText(
  text: string,
  embedder: EmbedderConfig,
  task: EmbedTask = "passage"
): Promise<Float32Array> {
  const url = embedder.url.replace(/\/+$/, "");
  const res = await fetch(`${url}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [text],
      task: teiTaskId(task),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`tei embed ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as number[][] | { embeddings?: number[][] };
  // Native /embed returns `[[...]]`. The OpenAI-compat path returns
  // `{embeddings: [[...]]}`. Accept both so a misconfigured proxy in
  // front of TEI doesn't bring everything down.
  const arr = Array.isArray(data) ? data : data.embeddings;
  if (!Array.isArray(arr) || arr.length === 0 || !Array.isArray(arr[0])) {
    throw new Error("tei embed returned empty response");
  }
  return new Float32Array(arr[0]);
}

// ---------------------------------------------------------------------
// Storage helpers (unchanged).
// ---------------------------------------------------------------------

export function embeddingToBuffer(emb: Float32Array): Buffer {
  return Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength);
}

export function embeddingFromBuffer(buf: Buffer | Uint8Array): Float32Array {
  const u8 = buf instanceof Buffer ? buf : Buffer.from(buf);
  return new Float32Array(
    u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  );
}

export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}
