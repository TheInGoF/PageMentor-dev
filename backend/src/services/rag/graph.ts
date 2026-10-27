// Wissensgraph eines Moduls: Kapitel als Knoten (Mittelwert ihrer Abschnitt-Vektoren),
// Kanten zu den ähnlichsten Kapiteln anderer Dokumente
import { db } from "../../db";
import { cosineSim, embeddingFromBuffer } from "../embeddings";

export interface GraphNode {
  id: string;
  title: string;
  documentId: string;
  documentTitle: string;
  page: number;
}

export interface GraphEdge {
  a: string;
  b: string;
  weight: number;
}

const MAX_NODES = 150;

export function centroid(vectors: Float32Array[]): Float32Array {
  const out = new Float32Array(vectors[0].length);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i] / vectors.length;
  return out;
}

// Je Knoten die zwei stärksten Verbindungen zu anderen Dokumenten, ab einer Mindestähnlichkeit
export function edgesFor(nodes: Array<{ id: string; documentId: string; vec: Float32Array }>, perNode = 2, minSim = 0.5): GraphEdge[] {
  const seen = new Map<string, GraphEdge>();
  for (const n of nodes) {
    const best = nodes
      .filter((m) => m.documentId !== n.documentId)
      .map((m) => ({ m, s: cosineSim(n.vec, m.vec) }))
      .filter((x) => x.s >= minSim)
      .sort((x, y) => y.s - x.s)
      .slice(0, perNode);
    for (const { m, s } of best) {
      const key = [n.id, m.id].sort().join("|");
      if (!seen.has(key)) seen.set(key, { a: n.id < m.id ? n.id : m.id, b: n.id < m.id ? m.id : n.id, weight: Math.round(s * 100) / 100 });
    }
  }
  return [...seen.values()];
}

export function moduleGraph(moduleId: string): { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean } {
  const rows = db()
    .prepare(
      `SELECT ch.id, ch.title, ch.start_page, d.id AS doc_id, d.title AS doc_title, c.embedding
         FROM chapters ch JOIN documents d ON d.id = ch.document_id JOIN chunks c ON c.chapter_id = ch.id
        WHERE d.module_id = ? AND c.embedding IS NOT NULL AND ch.kind IN ('content', 'summary', 'example')`
    )
    .all(moduleId) as Array<{ id: string; title: string; start_page: number; doc_id: string; doc_title: string; embedding: Buffer }>;
  const byChapter = new Map<string, { node: GraphNode; vecs: Float32Array[] }>();
  for (const r of rows) {
    const e = byChapter.get(r.id) ?? { node: { id: r.id, title: r.title, documentId: r.doc_id, documentTitle: r.doc_title, page: r.start_page }, vecs: [] };
    e.vecs.push(embeddingFromBuffer(r.embedding));
    byChapter.set(r.id, e);
  }
  const all = [...byChapter.values()];
  const truncated = all.length > MAX_NODES;
  const used = all.slice(0, MAX_NODES).map((e) => ({ ...e.node, vec: centroid(e.vecs) }));
  return { nodes: used.map(({ vec: _v, ...n }) => n), edges: edgesFor(used.map((n) => ({ id: n.id, documentId: n.documentId, vec: n.vec }))), truncated };
}
