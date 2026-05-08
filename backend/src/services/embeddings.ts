/**
 * Embedding generation. Two backends supported:
 *
 *  1. **TEI** (HuggingFace Text Embeddings Inference) — preferred when
 *     `PM_TEI_URL` is set. Required for jina-embeddings-v3 (which
 *     Ollama can't run because there's no GGUF). TEI exposes
 *     task-specific LoRA prefixes (`retrieval.passage` for indexing,
 *     `retrieval.query` for search) which give jina-v3 its DE-retrieval
 *     edge over v2.
 *
 *  2. **Ollama** — fallback when TEI is not configured or unreachable.
 *     Uses `/api/embeddings` with one of the preferred models in the
 *     list below.
 *
 * Storage in SQLite as BLOB: Float32 array binary. 768 dim × 4 bytes =
 * 3 KB / chunk (jina-v2). 1024 dim = 4 KB / chunk (jina-v3, bge-m3).
 * Brute-force cosine over 10 k chunks ~100 ms in JS — fine until we
 * actually move to Qdrant.
 *
 * IMPORTANT: switching backends or models changes the vector space and
 * makes existing embeddings incomparable. The DB column
 * `chunks.embedding_model` records what produced each row; the reindex
 * endpoint compares against the current embedder and re-embeds rows
 * that don't match.
 */

import { effective, getLlmConfig } from "./llmConfig";

const ENV_DEFAULT = process.env.PM_EMBED_MODEL || "";

const PREFERRED_EMBED_MODELS = [
  "jina/jina-embeddings-v2-base-de",
  "bge-m3",
  "nomic-embed-text",
];

const FALLBACK_MODEL = "nomic-embed-text";

export type EmbedBackend = "ollama" | "tei";

/** Task hint forwarded to TEI for jina-v3-style models that have
 *  task-specific LoRA adapters. Ollama ignores this. */
export type EmbedTask = "passage" | "query";

export interface EmbedderConfig {
  backend: EmbedBackend;
  url: string;
  /** Model identifier as stored in `chunks.embedding_model`. For TEI
   *  we prefix with `tei:` so it's unambiguous which backend produced
   *  the vector — `tei:jinaai/jina-embeddings-v3` ≠ `jina/jina-embeddings-v2-base-de`
   *  even though both are "jina". */
  model: string;
}

// ---------------------------------------------------------------------
// TEI backend
// ---------------------------------------------------------------------

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

async function embedTextTei(
  text: string,
  embedder: EmbedderConfig,
  task: EmbedTask
): Promise<Float32Array> {
  const url = embedder.url.replace(/\/+$/, "");
  const res = await fetch(`${url}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [text],
      // The `task` field is jina-v3-specific; TEI forwards it to the
      // model's LoRA selector. Servers running other models simply
      // ignore the field, so this is safe even if the user runs TEI
      // with a non-jina model.
      task: teiTaskId(task),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`tei embed ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as number[][] | { embeddings?: number[][] };
  // TEI native /embed returns `[[...]]`. The OpenAI-compat path returns
  // `{embeddings: [[...]]}`. We handle both shapes so a misconfigured
  // proxy doesn't bring everything down.
  const arr = Array.isArray(data) ? data : data.embeddings;
  if (!Array.isArray(arr) || arr.length === 0 || !Array.isArray(arr[0])) {
    throw new Error("tei embed returned empty response");
  }
  return new Float32Array(arr[0]);
}

// ---------------------------------------------------------------------
// Ollama backend
// ---------------------------------------------------------------------

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

function matchInstalled(wanted: string, installed: string[]): string | null {
  if (installed.includes(wanted)) return wanted;
  const tagged = installed.find(
    (n) => n === wanted || n.startsWith(wanted + ":")
  );
  return tagged ?? null;
}

function pickEmbedModel(installed: string[]): string {
  if (ENV_DEFAULT) {
    const found = matchInstalled(ENV_DEFAULT, installed);
    if (found) return found;
    return ENV_DEFAULT;
  }
  for (const model of PREFERRED_EMBED_MODELS) {
    const found = matchInstalled(model, installed);
    if (found) return found;
  }
  return FALLBACK_MODEL;
}

async function embedTextOllama(
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

// ---------------------------------------------------------------------
// Resolver — picks TEI if reachable, Ollama otherwise.
// ---------------------------------------------------------------------

/** Determines the active embedding backend. TEI takes priority when
 *  configured AND reachable. Falls back to Ollama (existing chain) so
 *  installs without TEI keep working unchanged. */
export async function resolveEmbedder(): Promise<EmbedderConfig | null> {
  // 1. TEI — if configured. Failure to reach a *configured* TEI is a
  //    soft warning + fallback, not a hard error. Reason: during a
  //    container restart the TEI box may be briefly down; we'd rather
  //    serve a (compatible) Ollama embed than crash the pipeline.
  const teiUrl = effective("teiUrl", "PM_TEI_URL");
  if (teiUrl) {
    const info = await teiInfo(teiUrl);
    if (info) {
      const model = `tei:${info.modelId}`;
      console.log(`[embeddings] using ${model} on ${teiUrl}`);
      return { backend: "tei", url: teiUrl, model };
    }
    console.warn(
      `[embeddings] TEI configured at ${teiUrl} but unreachable, falling back to Ollama`
    );
  }

  // 2. Ollama chain — same logic as before.
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
      if (installed.length === 0) continue;
      const model = pickEmbedModel(installed);
      console.log(
        `[embeddings] using ${model} on ${url}` +
          (installed.includes(model) ? "" : " (NOT INSTALLED — pull first)")
      );
      return { backend: "ollama", url, model };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Embeds a text. `task` controls the TEI LoRA prefix:
 *   - `"passage"` (default): for indexing chunks
 *   - `"query"`: for retrieval queries (questions, search inputs)
 *
 *  Ollama ignores `task` — it doesn't have task-specific adapters. Pass
 *  it anyway so call sites are explicit and a future Ollama → TEI
 *  switch doesn't degrade quality silently. */
export async function embedText(
  text: string,
  embedder: EmbedderConfig,
  task: EmbedTask = "passage"
): Promise<Float32Array> {
  if (embedder.backend === "tei") {
    return embedTextTei(text, embedder, task);
  }
  return embedTextOllama(text, embedder);
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
