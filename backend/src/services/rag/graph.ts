// Zusammenhänge eines Moduls: Kapitel als Knoten (Mittelwert ihrer Abschnitt-Vektoren), Verbindungen zu den
// ähnlichsten Kapiteln anderer Hefte. Zusammenfassungen zählen zu ihrem Kapitel, Pseudo-Kapitel (nur Zahlen)
// fallen weg. Weil ein Modul ein Fachgebiet ist, gilt eine relative Schwelle (oberes Fünftel der Paare).
// Jede Verbindung nennt die gemeinsamen Fachbegriffe; zusammenhängende Kapitel bilden Themen.
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
  terms?: string[];
}

export interface GraphTopic {
  terms: string[];
  nodes: string[];
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

// Schwelle relativ zum Modul: Ähnlichkeit, die nur das oberste Fünftel aller Paare aus verschiedenen Heften erreicht
export function relativeThreshold(nodes: Array<{ documentId: string; vec: Float32Array }>, quantile = 0.8, floor = 0.5): number {
  const sims: number[] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) if (nodes[i].documentId !== nodes[j].documentId) sims.push(cosineSim(nodes[i].vec, nodes[j].vec));
  if (!sims.length) return floor;
  sims.sort((a, b) => a - b);
  return Math.max(floor, sims[Math.min(sims.length - 1, Math.floor(sims.length * quantile))]);
}

// Wörter, die in jedem Lehrheft vorkommen und nichts über das Thema sagen
const GENERIC = new Set(
  "abbildung beispiel beispiele kapitel tabelle aufgabe aufgaben lösung lösungen studienheft zusammenfassung seite seiten übung übungen einführung abschnitt bereich anwendung grundlagen insbesondere allgemeinen beziehungsweise folgenden zwischen verschiedenen beispielsweise darstellung bedeutung gleichung gleichungen formel definition literatur hinweis weitere".split(" ")
);

// Fachbegriffe: großgeschriebene Wörter ab 5 Buchstaben (deutsche Substantive) und Wörter mit Bindestrich
export function terms(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of text.matchAll(/\b\p{Lu}[\p{L}-]{4,}\b/gu)) {
    const w = m[0].replace(/-+$/, "");
    const key = w.toLowerCase();
    if (GENERIC.has(key)) continue;
    out.set(w, (out.get(w) ?? 0) + 1);
  }
  return out;
}

// TF-IDF je Kapitel: was dieses Kapitel von den anderen im Modul unterscheidet
export function weightedTerms(texts: Map<string, string>): Map<string, Map<string, number>> {
  const tf = new Map([...texts].map(([id, t]) => [id, terms(t)]));
  const df = new Map<string, number>();
  for (const m of tf.values()) for (const w of m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const n = tf.size;
  const out = new Map<string, Map<string, number>>();
  for (const [id, m] of tf) {
    const scored = new Map<string, number>();
    for (const [w, c] of m) {
      const d = df.get(w) ?? 1;
      if (c < 2 || d === n) continue;
      scored.set(w, Math.log(1 + c) * Math.log(n / d));
    }
    out.set(id, new Map([...scored].sort((a, b) => b[1] - a[1]).slice(0, 40)));
  }
  return out;
}

function shared(a: Map<string, number> | undefined, b: Map<string, number> | undefined, k = 3): string[] {
  if (!a || !b) return [];
  return [...a]
    .filter(([w]) => b.has(w))
    .map(([w, s]) => [w, Math.min(s, b.get(w)!)] as const)
    .sort((x, y) => y[1] - x[1])
    .slice(0, k)
    .map(([w]) => w);
}

// Themen: zusammenhängende Kapitel über die Verbindungen; benannt nach den häufigsten gemeinsamen Begriffen
export function topicsFor(nodeIds: string[], edges: GraphEdge[], weights: Map<string, Map<string, number>>): GraphTopic[] {
  const parent = new Map(nodeIds.map((id) => [id, id]));
  const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  for (const e of edges) parent.set(find(e.a), find(e.b));
  const groups = new Map<string, string[]>();
  for (const id of nodeIds) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const score = new Map<string, number>();
      for (const id of g) for (const [w, s] of weights.get(id) ?? []) score.set(w, (score.get(w) ?? 0) + s);
      // Nur Begriffe aus mindestens zwei Kapiteln des Themas
      const inMany = [...score].filter(([w]) => g.filter((id) => weights.get(id)?.has(w)).length > 1);
      return { terms: inMany.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w), nodes: g };
    })
    .sort((a, b) => b.nodes.length - a.nodes.length);
}

export function moduleGraph(moduleId: string): { nodes: GraphNode[]; edges: GraphEdge[]; topics: GraphTopic[]; truncated: boolean } {
  const chapters = db()
    .prepare(
      `SELECT ch.id, ch.title, ch.start_page, ch.kind, ch.sort_order, ch.number, ch.text, d.id AS doc_id, d.title AS doc_title
         FROM chapters ch JOIN documents d ON d.id = ch.document_id
        WHERE d.module_id = ? AND ch.kind IN ('content', 'summary', 'example')
        ORDER BY d.id, ch.sort_order, ch.number`
    )
    .all(moduleId) as Array<{ id: string; title: string; start_page: number; kind: string; doc_id: string; doc_title: string; text: string }>;
  // Zusammenfassungen, Beispiele und Pseudo-Kapitel ("1111 1110.") gehören zum vorigen Kapitel desselben Hefts
  const owner = new Map<string, string>();
  const nodes = new Map<string, GraphNode>();
  let last: { id: string; doc: string } | null = null;
  for (const c of chapters) {
    const junk = !/\p{L}{3,}/u.test(c.title ?? "");
    if ((c.kind !== "content" || junk) && last && last.doc === c.doc_id) {
      owner.set(c.id, last.id);
      continue;
    }
    if (junk) continue;
    nodes.set(c.id, { id: c.id, title: c.title, documentId: c.doc_id, documentTitle: c.doc_title, page: c.start_page });
    owner.set(c.id, c.id);
    last = { id: c.id, doc: c.doc_id };
  }
  const texts = new Map<string, string>();
  for (const c of chapters) {
    const o = owner.get(c.id);
    if (o) texts.set(o, `${texts.get(o) ?? ""}\n${c.text ?? ""}`);
  }

  const rows = db()
    .prepare(`SELECT c.chapter_id, c.embedding FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.module_id = ? AND c.embedding IS NOT NULL`)
    .all(moduleId) as Array<{ chapter_id: string | null; embedding: Buffer }>;
  const vecs = new Map<string, Float32Array[]>();
  for (const r of rows) {
    const o = r.chapter_id ? owner.get(r.chapter_id) : undefined;
    if (o) vecs.set(o, [...(vecs.get(o) ?? []), embeddingFromBuffer(r.embedding)]);
  }
  const all = [...nodes.values()].filter((n) => vecs.has(n.id));
  const truncated = all.length > MAX_NODES;
  const used = all.slice(0, MAX_NODES).map((n) => ({ ...n, vec: centroid(vecs.get(n.id)!) }));

  const threshold = relativeThreshold(used);
  const weights = weightedTerms(new Map(used.map((n) => [n.id, texts.get(n.id) ?? ""])));
  const edges = edgesFor(used, 2, threshold).map((e) => ({ ...e, terms: shared(weights.get(e.a), weights.get(e.b)) }));
  const topics = topicsFor(
    used.map((n) => n.id),
    edges,
    weights
  );
  return { nodes: used.map(({ vec: _v, ...n }) => n), edges, topics, truncated };
}
