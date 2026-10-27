// Hybride Suche: Vektor- und Volltext-Treffer per Reciprocal Rank Fusion zusammenführen
import { db } from "../../db";
import { cosineSim, embeddingFromBuffer, embedText, resolveEmbedder } from "../embeddings";
import { ftsSearch } from "./fts";
import { vecSearch, vecState } from "./vec";

const RRF_K = 60;
const CANDIDATES = 50;

// Jede Liste trägt 1/(60 + Rang) bei; was in beiden weit oben steht, gewinnt
export function rrf(lists: number[][], k = RRF_K): Array<{ rowid: number; score: number }> {
  const score = new Map<number, number>();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].map(([rowid, s]) => ({ rowid, score: s })).sort((a, b) => b.score - a.score);
}

export interface HybridResult {
  rowids: number[];
  mode: "hybrid" | "text" | "vector";
}

// Ohne sqlite-vec: alle Vektoren im Bereich lesen (bis einige Tausend Abschnitte vertretbar)
function bruteForce(q: Float32Array, k: number, moduleId: string | null): number[] {
  const rows = db()
    .prepare(`SELECT c.rowid AS rowid, c.embedding FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.embedding IS NOT NULL${moduleId ? " AND d.module_id = ?" : ""}`)
    .all(...(moduleId ? [moduleId] : [])) as Array<{ rowid: number; embedding: Buffer }>;
  return rows
    .map((r) => ({ rowid: r.rowid, s: (() => { const v = embeddingFromBuffer(r.embedding); return v.length === q.length ? cosineSim(q, v) : -2; })() }))
    .filter((r) => r.s > -2)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((r) => r.rowid);
}

export async function hybridSearch(question: string, moduleId: string | null, topK: number): Promise<HybridResult> {
  const d = db();
  const text = ftsSearch(d, question, CANDIDATES, moduleId).map((r) => r.rowid);
  let vector: number[] = [];
  const embedder = await resolveEmbedder().catch(() => null);
  if (embedder) {
    const q = await embedText(question, embedder, "query");
    vector = vecState.available ? vecSearch(d, q, CANDIDATES, moduleId).map((r) => r.rowid) : bruteForce(q, CANDIDATES, moduleId);
  }
  const mode = vector.length && text.length ? "hybrid" : vector.length ? "vector" : "text";
  return { rowids: rrf([vector, text]).slice(0, topK).map((r) => r.rowid), mode };
}
