/**
 * Embedding generation via an OpenAI-compatible embedding server.
 *
 * We target `infinity` (michaelf34/infinity) as the deployed backend
 * because it supports jina-v3's `trust_remote_code` architecture
 * (XLM-RoBERTa with LoRA adapters), which HuggingFace's own TEI
 * cannot host — TEI is a pure Rust binary without a Python
 * interpreter. The PageMentor config field stays named `teiUrl` /
 * `PM_TEI_URL` for backward compatibility, but the protocol is
 * OpenAI's `/embeddings`, not TEI's native `/embed`.
 *
 * Any other OpenAI-compatible embedding server (Ollama's
 * `/embeddings`, vLLM, llama.cpp server, …) also works, as long as
 * it accepts `{model, input}` and returns `{data: [{embedding}]}`.
 *
 * Single backend by design. We previously had an Ollama fallback for
 * jina-v2-base-de / bge-m3 / nomic-embed-text, but the fallback path
 * could silently mix incompatible vectors into the same DB if the
 * embedding server was briefly down — different models live in
 * different vector spaces. Better to fail loud and force the operator
 * to fix the embed server than to dilute the corpus.
 *
 * Deployed model is BAAI/bge-m3 (since v1.19.5; jina-v3 needed Triton
 * builds that fail under WSL). The `task` field below was for jina-v3's
 * LoRA adapters; bge-m3 ignores it, sending it stays harmless.
 *
 * Storage in SQLite as Float32 BLOB. bge-m3 = 1024 dim × 4 bytes =
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

interface EmbedderInfo {
  modelId: string;
}

/** Health probe using OpenAI's `/models` endpoint. Returns the first
 *  loaded model id — for our infinity setup that's the only model on
 *  the server, so it's also the one we'll embed against. */
async function probeEmbedder(url: string): Promise<EmbedderInfo | null> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/models`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: Array<{ id?: string }>;
    };
    // Neben dem Embedder läuft der Reranker im selben Server
    const modelId = data.data?.map((m) => m.id).find((id) => id && !/rerank/i.test(id));
    if (!modelId) return null;
    return { modelId };
  } catch {
    return null;
  }
}

function teiTaskId(task: EmbedTask): string {
  return task === "query" ? "retrieval.query" : "retrieval.passage";
}

/** Resolves the active embedder. Returns null when the embed server
 *  is not configured or unreachable — callers must handle that as a
 *  hard failure (no fallback). */
export async function resolveEmbedder(): Promise<EmbedderConfig | null> {
  const url = effective("teiUrl", "PM_TEI_URL");
  if (!url) {
    console.warn(
      "[embeddings] no embedding server configured (set teiUrl in settings or PM_TEI_URL env)"
    );
    return null;
  }
  const info = await probeEmbedder(url);
  if (!info) {
    console.warn(`[embeddings] embedding server at ${url} unreachable`);
    return null;
  }
  // Keep the `tei:` prefix in the DB tag for backward compatibility
  // — existing rows reference it and the reembed endpoint matches on
  // exact string. The underlying server is now infinity, but the tag
  // namespace stays stable.
  const model = `tei:${info.modelId}`;
  console.log(`[embeddings] using ${model} on ${url}`);
  return { url, model };
}

/** Embeds a single text via OpenAI-compatible `/embeddings`.
 *
 *  `task` selects the jina-v3 LoRA adapter:
 *   - `"passage"` (default): indexing chunks
 *   - `"query"`: retrieval queries (questions, search inputs)
 *
 *  The `task` field is non-OpenAI but infinity forwards it to jina-v3.
 *  Servers that don't recognize the field ignore it silently — safe to
 *  always send. Always pair `passage` (index time) with `query` (search
 *  time); mixing tasks within a corpus loses the v3 retrieval edge. */
export async function embedText(
  text: string,
  embedder: EmbedderConfig,
  task: EmbedTask = "passage"
): Promise<Float32Array> {
  const url = embedder.url.replace(/\/+$/, "");
  // Strip our internal `tei:` prefix to recover the bare HF model id
  // that the server expects in the `model` field.
  const modelId = embedder.model.replace(/^tei:/, "");
  const res = await fetch(`${url}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelId,
      input: [text],
      task: teiTaskId(task),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `embed server ${res.status}: ${body.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vec = data.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error("embed server returned empty embedding");
  }
  return new Float32Array(vec);
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
