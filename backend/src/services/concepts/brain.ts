// Gehirn-Ansicht: das globale Begriffsnetz als Graph. Begriffe sind Punkte (Größe = wie oft sie vorkommen,
// Farbe = Modul mit den meisten Fundstellen), Linien sind „baut auf“-Verbindungen aus den Kapiteln
import { db } from "../../db";

export interface BrainNode {
  id: string;
  name: string;
  mentions: number;
  // Modul mit den meisten Fundstellen, für die Farbe
  moduleId: string | null;
  // Anzahl Module, in denen der Begriff vorkommt (Brückenbegriffe > 1)
  modules: number;
  explained: boolean;
}
export interface BrainEdge {
  a: string;
  b: string;
  weight: number;
}
export interface BrainGraph {
  nodes: BrainNode[];
  edges: BrainEdge[];
  modules: Array<{ id: string; name: string; icon: string | null }>;
  total: { concepts: number; links: number };
}

const MAX_LIMIT = 400;

// Knoten zu den Begriff-IDs (Fundstellen optional auf ein Modul beschränkt)
function nodesFor(ids: string[]): BrainNode[] {
  if (!ids.length) return [];
  const rows = db()
    .prepare(
      `SELECT k.id, k.name, d.module_id, COUNT(*) AS n, MAX(m.role = 'explains') AS ex
         FROM concepts k JOIN concept_mentions m ON m.concept_id = k.id JOIN documents d ON d.id = m.document_id
        WHERE k.id IN (${ids.map(() => "?").join(",")})
        GROUP BY k.id, d.module_id`
    )
    .all(...ids) as Array<{ id: string; name: string; module_id: string | null; n: number; ex: number }>;
  const byId = new Map<string, BrainNode & { best: number }>();
  for (const r of rows) {
    const cur = byId.get(r.id) ?? { id: r.id, name: r.name, mentions: 0, moduleId: null, modules: 0, explained: false, best: -1 };
    cur.mentions += r.n;
    cur.modules += 1;
    cur.explained ||= !!r.ex;
    if (r.n > cur.best) Object.assign(cur, { best: r.n, moduleId: r.module_id });
    byId.set(r.id, cur);
  }
  return [...byId.values()].map(({ best: _b, ...n }) => n);
}

// Verbindungen zwischen den gezeigten Begriffen; Gewicht = in wie vielen Kapiteln sie verknüpft sind
function edgesFor(ids: Set<string>): BrainEdge[] {
  const rows = db().prepare("SELECT concept_id AS a, needs_id AS b, COUNT(*) AS w FROM concept_links GROUP BY concept_id, needs_id").all() as Array<{ a: string; b: string; w: number }>;
  return rows.filter((r) => r.a !== r.b && ids.has(r.a) && ids.has(r.b)).map((r) => ({ a: r.a, b: r.b, weight: r.w }));
}

// Die wichtigsten Begriffe: viele Fundstellen und viele Verbindungen; optional nur ein Modul
export function brainGraph(opts: { moduleId?: string; limit?: number } = {}): BrainGraph {
  const d = db();
  const limit = Math.min(MAX_LIMIT, Math.max(10, opts.limit ?? 150));
  const filter = opts.moduleId ? "WHERE d.module_id = ?" : "";
  const ranked = d
    .prepare(
      `SELECT m.concept_id AS id,
              COUNT(*) + 2 * (SELECT COUNT(*) FROM concept_links l WHERE l.concept_id = m.concept_id OR l.needs_id = m.concept_id) AS score
         FROM concept_mentions m JOIN documents d ON d.id = m.document_id ${filter}
        GROUP BY m.concept_id ORDER BY score DESC LIMIT ?`
    )
    .all(...(opts.moduleId ? [opts.moduleId, limit] : [limit])) as Array<{ id: string }>;
  const ids = ranked.map((r) => r.id);
  const modules = d.prepare("SELECT id, name, icon FROM modules ORDER BY name COLLATE NOCASE").all() as BrainGraph["modules"];
  const total = {
    concepts: (d.prepare("SELECT COUNT(*) AS n FROM concepts").get() as { n: number }).n,
    links: (d.prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT concept_id, needs_id FROM concept_links)").get() as { n: number }).n,
  };
  return { nodes: nodesFor(ids), edges: edgesFor(new Set(ids)), modules, total };
}

// Zusätzliche Knoten und Kanten für Begriffe, die eine Aktivierung erreicht hat, aber nicht im Bild sind
export function brainExtend(have: string[], add: string[]): { nodes: BrainNode[]; edges: BrainEdge[] } {
  const all = new Set([...have, ...add]);
  const fresh = add.filter((id) => !have.includes(id));
  const edges = edgesFor(all).filter((e) => fresh.includes(e.a) || fresh.includes(e.b));
  return { nodes: nodesFor(fresh), edges };
}

// Einzelner Begriff: Erklärung, Fundstellen, Grundlagen und was darauf aufbaut
export function conceptDetail(id: string) {
  const d = db();
  const c = d.prepare("SELECT id, name, definition FROM concepts WHERE id = ?").get(id) as { id: string; name: string; definition: string | null } | undefined;
  if (!c) return null;
  const places = d
    .prepare(
      `SELECT m.role, ch.title AS chapter, ch.start_page AS page, doc.id AS docId, doc.title AS doc, mo.name AS module
         FROM concept_mentions m JOIN chapters ch ON ch.id = m.chapter_id JOIN documents doc ON doc.id = m.document_id
         LEFT JOIN modules mo ON mo.id = doc.module_id
        WHERE m.concept_id = ? ORDER BY m.role = 'explains' DESC, doc.title, ch.start_page`
    )
    .all(id) as Array<{ role: string; chapter: string; page: number; docId: string; doc: string; module: string | null }>;
  const needs = d.prepare("SELECT DISTINCT n.id, n.name FROM concept_links l JOIN concepts n ON n.id = l.needs_id WHERE l.concept_id = ?").all(id);
  const neededBy = d.prepare("SELECT DISTINCT n.id, n.name FROM concept_links l JOIN concepts n ON n.id = l.concept_id WHERE l.needs_id = ?").all(id);
  return { ...c, places: places.map(({ role, ...p }) => ({ ...p, explains: role === "explains" })), needs, neededBy };
}
