// Ausbreitung im Begriffsnetz, wie Aktivierung im Gehirn: Die Begriffe der Frage und der besten Treffer
// starten mit voller Stärke, ihre Voraussetzungen bekommen auf jeder Ebene die Hälfte (bis Ebene 3).
// Ergebnis: die Begriffskette für Gemma und die Kapitel, die die Grundlagen erklären
import { db } from "../../db";
import { cosineSim, embeddingFromBuffer } from "../embeddings";
import { linkKey, linkStatus } from "./links";

const DECAY = 0.5;
const MAX_DEPTH = 3;
const MAX_ACTIVE = 15;
// Kapitel-Hervorhebung im Gehirn: alle Begriffe des Kapitels samt Grundlagen
const MAX_CHAPTER = 60;
const QUERY_MATCH = 0.55;

export interface ActiveConcept {
  id: string;
  name: string;
  definition: string | null;
  depth: number;
  strength: number;
  // Über welchen Begriff er erreicht wurde (eine Ebene darüber)
  via?: string;
}

interface Link {
  from: string;
  to: string;
}

// Reine Ausbreitung, ohne Datenbank: gut testbar
export function spread(seeds: Map<string, number>, links: Link[], maxDepth = MAX_DEPTH, decay = DECAY): Map<string, { depth: number; strength: number; via?: string }> {
  const needs = new Map<string, string[]>();
  for (const l of links) needs.set(l.from, [...(needs.get(l.from) ?? []), l.to]);
  const out = new Map<string, { depth: number; strength: number; via?: string }>();
  for (const [id, s] of seeds) out.set(id, { depth: 0, strength: s });
  let frontier = [...seeds.keys()];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const base = out.get(id)!.strength * decay;
      for (const to of needs.get(id) ?? []) {
        const cur = out.get(to);
        if (cur && cur.strength >= base) continue;
        out.set(to, { depth: cur ? Math.min(cur.depth, depth) : depth, strength: base, via: id });
        next.push(to);
      }
    }
    frontier = next;
  }
  return out;
}

// Startbegriffe: Begriffe der Treffer-Kapitel und Begriffe, die der Frage inhaltlich nahe sind
function seedConcepts(query: Float32Array | null, chapterIds: string[]): Map<string, number> {
  const d = db();
  const seeds = new Map<string, number>();
  if (chapterIds.length) {
    const rows = d
      .prepare(`SELECT DISTINCT concept_id FROM concept_mentions WHERE role = 'explains' AND chapter_id IN (${chapterIds.map(() => "?").join(",")})`)
      .all(...chapterIds) as Array<{ concept_id: string }>;
    for (const r of rows) seeds.set(r.concept_id, 0.6);
  }
  if (query) {
    const rows = d.prepare("SELECT id, embedding FROM concepts WHERE embedding IS NOT NULL").all() as Array<{ id: string; embedding: Buffer }>;
    rows
      .map((r) => ({ id: r.id, s: (() => { const v = embeddingFromBuffer(r.embedding); return v.length === query.length ? cosineSim(query, v) : 0; })() }))
      .filter((x) => x.s >= QUERY_MATCH)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .forEach((x) => seeds.set(x.id, Math.max(seeds.get(x.id) ?? 0, x.s + 0.4)));
  }
  return seeds;
}

export function activate(query: Float32Array | null, chapterIds: string[]): ActiveConcept[] {
  const seeds = seedConcepts(query, chapterIds);
  if (!seeds.size) return [];
  // Nur gesicherte Verbindungen: ungesicherte würden falsche Grundlagen-Kapitel in die Antwort ziehen
  return withInfo([...spread(seeds, sureLinks())].sort((a, b) => b[1].strength - a[1].strength).slice(0, MAX_ACTIVE));
}

// Gesicherte Verbindungen als Kantenliste
function sureLinks(): Link[] {
  const sure = linkStatus();
  return (db().prepare("SELECT DISTINCT concept_id AS 'from', needs_id AS 'to' FROM concept_links").all() as Link[]).filter((l) => sure.has(linkKey(l.from, l.to)));
}

function withInfo(active: Array<[string, { depth: number; strength: number; via?: string }]>): ActiveConcept[] {
  const info = db().prepare("SELECT name, definition FROM concepts WHERE id = ?");
  return active.map(([id, a]) => {
    const c = info.get(id) as { name: string; definition: string | null } | undefined;
    return { id, name: c?.name ?? "?", definition: c?.definition ?? null, depth: a.depth, strength: a.strength, via: a.via };
  });
}

// Ein Kapitel hervorheben: erklärte Begriffe voll, benutzte schwächer, dazu die Grundlagen über gesicherte Verbindungen
export function chapterActivation(chapterId: string): ActiveConcept[] {
  const rows = db().prepare("SELECT concept_id, role FROM concept_mentions WHERE chapter_id = ?").all(chapterId) as Array<{ concept_id: string; role: string }>;
  const seeds = new Map(rows.map((r) => [r.concept_id, r.role === "explains" ? 1 : 0.6]));
  if (!seeds.size) return [];
  return withInfo([...spread(seeds, sureLinks())].sort((a, b) => b[1].strength - a[1].strength).slice(0, MAX_CHAPTER));
}

// Kapitel, die die Voraussetzungen (Ebene 1 bis 3) erklären; je Begriff das erste passende
export function prerequisiteChapters(active: ActiveConcept[], allowedDocs?: Set<string>, limit = 4): Array<{ chapterId: string; conceptId: string }> {
  const stmt = db().prepare("SELECT chapter_id, document_id FROM concept_mentions WHERE concept_id = ? AND role = 'explains'");
  const out: Array<{ chapterId: string; conceptId: string }> = [];
  for (const c of active.filter((a) => a.depth > 0)) {
    const hit = (stmt.all(c.id) as Array<{ chapter_id: string; document_id: string }>).find((r) => !allowedDocs || allowedDocs.has(r.document_id));
    if (hit && !out.some((o) => o.chapterId === hit.chapter_id)) out.push({ chapterId: hit.chapter_id, conceptId: c.id });
    if (out.length >= limit) break;
  }
  return out;
}

// Begriffskette als Text für Gemma: was gefragt ist und worauf es aufbaut
export function conceptNetText(active: ActiveConcept[]): string {
  if (!active.length) return "";
  const byId = new Map(active.map((a) => [a.id, a]));
  const lines = active.map((a) => {
    const chain: string[] = [];
    for (let cur: ActiveConcept | undefined = a; cur; cur = cur.via ? byId.get(cur.via) : undefined) chain.push(cur.name);
    const path = a.depth > 0 ? ` (Voraussetzung, Ebene ${a.depth}: ${chain.reverse().join(" → ")})` : "";
    return `- ${a.name}${path}${a.definition ? `: ${a.definition}` : ""}`;
  });
  return lines.join("\n");
}
