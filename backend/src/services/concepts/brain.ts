// Gehirn-Ansicht: das globale Begriffsnetz als Graph. Begriffe sind Punkte (Größe = wie oft sie vorkommen),
// Linien sind „baut auf“-Verbindungen aus den Kapiteln. Jeder Begriff hat ein Heimat-Heft (meiste Fundstellen),
// danach gruppiert die Ansicht und beschriftet herausgezoomt mit Heft und Modul als Thema
import { db } from "../../db";
import { linkKey, linkStatus } from "./links";
import { normalizeConcept } from "./store";

export interface BrainNode {
  id: string;
  name: string;
  mentions: number;
  // Modul mit den meisten Fundstellen
  moduleId: string | null;
  // Heft mit den meisten Fundstellen, bei Gleichstand das, das den Begriff erklärt
  docId: string | null;
  // Anzahl Module, in denen der Begriff vorkommt (Brückenbegriffe > 1)
  modules: number;
  explained: boolean;
}
export interface BrainEdge {
  a: string;
  b: string;
  weight: number;
  // Gesichert: in zwei Kapiteln gefunden oder die Grundlage wird vorher erklärt
  sure: boolean;
}
export interface BrainGraph {
  nodes: BrainNode[];
  edges: BrainEdge[];
  modules: Array<{ id: string; name: string; icon: string | null }>;
  // Hefte mit Begriffen, nach Modul und Titel geordnet: Nachbarn im Bild
  docs: Array<{ id: string; title: string; moduleId: string | null }>;
  total: { concepts: number; links: number };
}

const MAX_LIMIT = 5000;

// Knoten zu den Begriff-IDs: Fundstellen je Heft, daraus Heimat-Heft und Modul mit den meisten Fundstellen
function nodesFor(ids: string[]): BrainNode[] {
  if (!ids.length) return [];
  const rows = db()
    .prepare(
      `SELECT k.id, k.name, d.id AS doc_id, d.module_id, COUNT(*) AS n, MAX(m.role = 'explains') AS ex
         FROM concepts k JOIN concept_mentions m ON m.concept_id = k.id JOIN documents d ON d.id = m.document_id
        WHERE k.id IN (${ids.map(() => "?").join(",")})
        GROUP BY k.id, d.id`
    )
    .all(...ids) as Array<{ id: string; name: string; doc_id: string; module_id: string | null; n: number; ex: number }>;
  const byId = new Map<string, BrainNode & { best: number; perModule: Map<string | null, number> }>();
  for (const r of rows) {
    const cur = byId.get(r.id) ?? { id: r.id, name: r.name, mentions: 0, moduleId: null, docId: null, modules: 0, explained: false, best: -1, perModule: new Map() };
    cur.mentions += r.n;
    cur.explained ||= !!r.ex;
    cur.perModule.set(r.module_id, (cur.perModule.get(r.module_id) ?? 0) + r.n);
    // Erklärt zählt wie eine halbe Fundstelle mehr: bei Gleichstand gewinnt das Heft, das den Begriff erklärt
    const score = r.n + (r.ex ? 0.5 : 0);
    if (score > cur.best) Object.assign(cur, { best: score, docId: r.doc_id });
    byId.set(r.id, cur);
  }
  return [...byId.values()].map(({ best: _b, perModule, ...n }) => ({
    ...n,
    modules: perModule.size,
    moduleId: [...perModule.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  }));
}

// Verbindungen zwischen den gezeigten Begriffen; Gewicht = in wie vielen Kapiteln sie verknüpft sind
function edgesFor(ids: Set<string>): BrainEdge[] {
  const sure = linkStatus();
  const rows = db().prepare("SELECT concept_id AS a, needs_id AS b, COUNT(*) AS w FROM concept_links GROUP BY concept_id, needs_id").all() as Array<{ a: string; b: string; w: number }>;
  return rows.filter((r) => r.a !== r.b && ids.has(r.a) && ids.has(r.b)).map((r) => ({ a: r.a, b: r.b, weight: r.w, sure: sure.has(linkKey(r.a, r.b)) }));
}

// Die wichtigsten Begriffe: viele Fundstellen und viele Verbindungen; optional nur ein Modul
export function brainGraph(opts: { moduleId?: string; limit?: number } = {}): BrainGraph {
  const d = db();
  // 0 = alle Begriffe (bis zur Obergrenze)
  const limit = opts.limit === 0 ? MAX_LIMIT : Math.min(MAX_LIMIT, Math.max(10, opts.limit ?? 150));
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
  // Nur Module mit Begriffen: Die Farbe hängt an der Position in dieser Liste und bleibt so stabil
  const modules = d
    .prepare("SELECT id, name, icon FROM modules WHERE id IN (SELECT DISTINCT d.module_id FROM concept_mentions m JOIN documents d ON d.id = m.document_id) ORDER BY name COLLATE NOCASE")
    .all() as BrainGraph["modules"];
  const docs = d
    .prepare(
      `SELECT d.id, COALESCE(NULLIF(TRIM(d.doc_title), ''), d.title) AS title, d.module_id AS moduleId FROM documents d LEFT JOIN modules mo ON mo.id = d.module_id
        WHERE d.id IN (SELECT DISTINCT document_id FROM concept_mentions) ORDER BY mo.name COLLATE NOCASE, title COLLATE NOCASE`
    )
    .all() as BrainGraph["docs"];
  const total = {
    concepts: (d.prepare("SELECT COUNT(*) AS n FROM concepts").get() as { n: number }).n,
    links: (d.prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT concept_id, needs_id FROM concept_links)").get() as { n: number }).n,
  };
  return { nodes: nodesFor(ids), edges: edgesFor(new Set(ids)), modules, docs, total };
}

// Schlagwortsuche: Name, Schreibweise oder Erklärung enthält das Wort
export function searchConcepts(q: string, limit = 300): string[] {
  const word = q.trim();
  if (word.length < 2) return [];
  const like = `%${word.toLowerCase()}%`;
  const norm = `%${normalizeConcept(word)}%`;
  return (
    db()
      .prepare(
        `SELECT DISTINCT k.id FROM concepts k LEFT JOIN concept_mentions m ON m.concept_id = k.id
          WHERE lower(k.name) LIKE ? OR k.norm LIKE ? OR lower(k.definition) LIKE ? OR lower(m.definition) LIKE ? LIMIT ?`
      )
      .all(like, norm, like, like, limit) as Array<{ id: string }>
  ).map((r) => r.id);
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
