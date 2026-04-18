/**
 * Embedding-Erzeugung via Ollama und Cosine-Similarity für den
 * brute-force RAG-Pfad.
 *
 * Wir nutzen Ollama's `/api/embeddings`-Endpoint. Default-Modell ist
 * `nomic-embed-text` (137 MB, 768 Dimensionen, CPU-freundlich). Kann
 * per ENV `PM_EMBED_MODEL` überschrieben werden.
 *
 * Speicherung im SQLite als BLOB: Float32-Array binary. 768 * 4 Byte =
 * 3 KB pro Chunk — für 10 k Chunks macht das 30 MB, in JS 100 ms
 * Brute-Force-Cosine über alles. Völlig OK bis wir Vector-DB
 * tatsächlich brauchen.
 */

import { getLlmConfig } from "./llmConfig";

const DEFAULT_MODEL = process.env.PM_EMBED_MODEL || "nomic-embed-text";

export interface EmbedderConfig {
  url: string;
  model: string;
}

/** Ermittelt welche Ollama-Instanz (und welches Modell) wir nutzen,
 *  anhand der Settings-Modal-Config + ENV-Overrides. Probiert die
 *  Kandidaten in der Chain-Order durch — PC-Ollama, Mac-Ollama,
 *  generic Ollama, ENV-Default. Claude/OpenAI/Gemini-Embeddings sind
 *  ein separater Pfad den wir hier nicht anfassen. */
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
      if (await ping(url)) return { url, model: DEFAULT_MODEL };
    }
  } catch {
    // fall through
  }
  return null;
}

async function ping(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Holt das Embedding für einen Text von Ollama. Wirft wenn der
 *  Endpoint nicht erreichbar oder das Modell nicht installiert ist. */
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

/** Float32Array ↔ Buffer (Node/Bun). Wir speichern die Bytes als BLOB
 *  im SQLite, 768 floats = 3072 bytes für nomic-embed-text. */
export function embeddingToBuffer(emb: Float32Array): Buffer {
  return Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength);
}

export function embeddingFromBuffer(buf: Buffer | Uint8Array): Float32Array {
  const u8 = buf instanceof Buffer ? buf : Buffer.from(buf);
  return new Float32Array(
    u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  );
}

/** Cosine-Similarity zweier gleichlanger Vektoren. Score zwischen
 *  -1 und 1, wir klammern nur pragmatisch für Score-Display. */
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
