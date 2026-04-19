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

const ENV_DEFAULT = process.env.PM_EMBED_MODEL || "";

/** Embedding-Modelle nach Präferenz. bge-m3 ist nativ multilingual
 *  und für deutsche Forschungs-/Studientexte deutlich stärker als
 *  das englisch-zentrierte nomic-embed-text (laut MTEB-DE Benchmark).
 *  Wenn der User PM_EMBED_MODEL hart setzt, gewinnt das. Ansonsten
 *  nehmen wir das erste auf dem Ollama-Server installierte Modell
 *  aus dieser Liste. */
const PREFERRED_EMBED_MODELS = [
  "bge-m3",
  "nomic-embed-text",
];

/** Letzter Fallback wenn weder ENV-Override noch ein präferiertes
 *  Modell installiert ist — embedText wirft dann 404 und der Caller
 *  weiß dass er was pullen muss. */
const FALLBACK_MODEL = "nomic-embed-text";

export interface EmbedderConfig {
  url: string;
  model: string;
}

/** Holt die Liste der gepullten Modelle vom Ollama-Server. */
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

/** Findet das beste passende Modell in der installierten Liste.
 *  Toleriert Tag-Suffixe (`bge-m3` matcht auch `bge-m3:latest`). */
function matchInstalled(wanted: string, installed: string[]): string | null {
  if (installed.includes(wanted)) return wanted;
  const tagged = installed.find((n) => n === wanted || n.startsWith(wanted + ":"));
  return tagged ?? null;
}

function pickEmbedModel(installed: string[]): string {
  if (ENV_DEFAULT) {
    const found = matchInstalled(ENV_DEFAULT, installed);
    if (found) return found;
    // ENV gesetzt aber nicht gepullt — wir nehmen ihn trotzdem,
    // damit der embedText-404 dem User zeigt was zu pullen ist.
    return ENV_DEFAULT;
  }
  for (const model of PREFERRED_EMBED_MODELS) {
    const found = matchInstalled(model, installed);
    if (found) return found;
  }
  return FALLBACK_MODEL;
}

/** Ermittelt welche Ollama-Instanz und welches Modell wir nutzen.
 *  Probiert die LLM-Chain-Endpoints in der konfigurierten Reihenfolge
 *  durch und wählt pro Server das beste verfügbare Embed-Modell. */
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
      if (installed.length === 0) continue; // server nicht erreichbar
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
