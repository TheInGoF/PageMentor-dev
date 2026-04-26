/**
 * Embedding generation via Ollama and cosine similarity for the
 * brute-force RAG path.
 *
 * We use Ollama's `/api/embeddings` endpoint. Default model is
 * `nomic-embed-text` (137 MB, 768 dimensions, CPU-friendly). Can be
 * overridden via the `PM_EMBED_MODEL` env var.
 *
 * Storage in SQLite as BLOB: Float32 array binary. 768 * 4 bytes =
 * 3 KB per chunk — for 10 k chunks that's 30 MB, brute-force cosine
 * over all of it in ~100 ms in JS. Perfectly fine until we actually
 * need a vector DB.
 */

import { getLlmConfig } from "./llmConfig";

const ENV_DEFAULT = process.env.PM_EMBED_MODEL || "";

/** Embedding models in order of preference. Order reflects suitability
 *  for German research/study texts:
 *
 *  1. jina/jina-embeddings-v2-base-de  — bilingual DE+EN, explicitly
 *     trained on German corpora. ~440 MB, 768 dim, 8k context.
 *     Beats bge-m3 and multilingual-e5-large on MTEB-DE at a
 *     fraction of the size.
 *  2. bge-m3  — multilingual (100+ languages), 2.3 GB, 1024 dim,
 *     8k context. Solid all-rounder, DE upper-mid tier but not
 *     specialized. Backup when the user has a multilingual library
 *     (DE + EN + other).
 *  3. nomic-embed-text  — English-centric, 137 MB, 768 dim,
 *     last fallback when nothing specialized is available.
 *
 *  When the user hard-sets PM_EMBED_MODEL, that wins. Otherwise we
 *  take the first installed model from this list.
 */
const PREFERRED_EMBED_MODELS = [
  "jina/jina-embeddings-v2-base-de",
  "bge-m3",
  "nomic-embed-text",
];

/** Final fallback when neither an ENV override nor a preferred model
 *  is installed — embedText then throws 404 and the caller knows
 *  they need to pull something. */
const FALLBACK_MODEL = "nomic-embed-text";

export interface EmbedderConfig {
  url: string;
  model: string;
}

/** Fetches the list of pulled models from the Ollama server. */
async function ollamaTagNames(url: string): Promise<string[]> {
  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/** Finds the best matching model in the installed list. Tolerates
 *  tag suffixes (`bge-m3` also matches `bge-m3:latest`). */
function matchInstalled(wanted: string, installed: string[]): string | null {
  if (installed.includes(wanted)) return wanted;
  const tagged = installed.find((n) => n === wanted || n.startsWith(wanted + ":"));
  return tagged ?? null;
}

function pickEmbedModel(installed: string[]): string {
  if (ENV_DEFAULT) {
    const found = matchInstalled(ENV_DEFAULT, installed);
    if (found) return found;
    // ENV set but not pulled — we still use it so the embedText 404
    // shows the user what to pull.
    return ENV_DEFAULT;
  }
  for (const model of PREFERRED_EMBED_MODELS) {
    const found = matchInstalled(model, installed);
    if (found) return found;
  }
  return FALLBACK_MODEL;
}

/** Determines which Ollama instance and which model we use. Tries
 *  the LLM chain endpoints in the configured order and picks the
 *  best available embed model on each server. */
export async function resolveEmbedder(): Promise<EmbedderConfig | null> {
  try {
    const cfg = getLlmConfig();
    const candidates = [
      cfg.ollamaUrlPc,
      cfg.ollamaUrlMac,
      cfg.ollamaUrl,
      process.env.PM_OLLAMA_URL,
      "http://host.docker.internal:11434",
    ].filter((u): u is string => !!u && u.trim().length > 0);

    for (const url of candidates) {
      const installed = await ollamaTagNames(url);
      if (installed.length === 0) continue; // server unreachable
      const model = pickEmbedModel(installed);
      console.log(
        `[embeddings] using ${model} on ${url}` +
          (installed.includes(model) ? "" : " (NOT INSTALLED — pull first)")
      );
      return { url, model };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Fetches the embedding for a text from Ollama. Throws if the
 *  endpoint is unreachable or the model isn't installed. */
export async function embedText(
  text: string,
  embedder: EmbedderConfig
): Promise<Float32Array> {
  const res = await fetch(`${embedder.url}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedder.model, prompt: text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ollama embed failed ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new Error("ollama embed returned empty embedding");
  }
  return new Float32Array(data.embedding);
}

/** Float32Array ↔ Buffer (Node/Bun). We store the bytes as BLOB in
 *  SQLite, 768 floats = 3072 bytes for nomic-embed-text. */
export function embeddingToBuffer(emb: Float32Array): Buffer {
  return Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength);
}

export function embeddingFromBuffer(buf: Buffer | Uint8Array): Float32Array {
  const u8 = buf instanceof Buffer ? buf : Buffer.from(buf);
  return new Float32Array(
    u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  );
}

/** Cosine similarity of two equal-length vectors. Score between
 *  -1 and 1; we clamp only pragmatically for score display. */
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
