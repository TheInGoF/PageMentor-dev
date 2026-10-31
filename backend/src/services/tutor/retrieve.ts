// Passende Textstücke für eine Frage finden
import { db } from "../../db";
import { hybridSearch } from "../rag/hybrid";
import { rerank } from "../rag/rerank";
import { associatedChunks, relatedChapters } from "../rag/associate";
import { activate, conceptNetText, prerequisiteChapters } from "../concepts/activate";
import { TOP_K, MAX_CHUNK_CHARS, type TutorSource } from "./types";


export interface ChunkRow {
  id: string;
  document_id: string;
  chapter_id: string | null;
  text: string;
  start_page: number;
  end_page: number;
  embedding: Buffer | null;
  doc_title: string;
  doc_short_code: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
}

export interface Retrieved {
  sources: TutorSource[];
  // Begriffskette aus dem Begriffsnetz (leer, solange keine Begriffe erfasst sind)
  conceptNet: string;
}

export async function retrieveChunks(question: string, moduleId: string | null): Promise<Retrieved> {
  // Volltext und Vektoren gemeinsam (ohne Embedder bleibt die Volltextsuche), dann sortiert der Reranker
  // die Kandidaten nach echter Relevanz und nur die besten gehen an Gemma
  const { rowids: found, query } = await hybridSearch(question, moduleId, RERANK_CANDIDATES);
  if (!found.length) return { sources: [], conceptNet: "" };
  const d = db();
  const seedRows = found.slice(0, ASSOCIATION_SEEDS);
  const seedChapters = (
    d.prepare(`SELECT DISTINCT chapter_id FROM chunks WHERE chapter_id IS NOT NULL AND rowid IN (${seedRows.map(() => "?").join(",")})`).all(...seedRows) as Array<{ chapter_id: string }>
  ).map((r) => r.chapter_id);
  const allowed = moduleId
    ? new Set((d.prepare("SELECT id FROM documents WHERE module_id = ?").all(moduleId) as Array<{ id: string }>).map((r) => r.id))
    : undefined;

  // Zusammenhänge als Gedächtnis: die besten Treffer holen passende Abschnitte verwandter Kapitel dazu
  const associated = query ? associatedChunks(query, relatedChapters(seedChapters, 2, 0.75, allowed), 2).filter((r) => !found.includes(r)) : [];
  const viaGraph = new Set(associated);

  // Begriffsnetz: Voraussetzungen bis Ebene 3, je Grundlage der passendste Abschnitt des erklärenden Kapitels
  const active = activate(query, seedChapters);
  const prereq = prerequisiteChapters(active, allowed);
  const viaConcept = new Map<number, string>();
  for (const p of prereq) {
    const rid = query ? associatedChunks(query, [p.chapterId], 1)[0] : undefined;
    const name = active.find((a) => a.id === p.conceptId)?.name;
    if (rid !== undefined && name && !found.includes(rid) && !viaGraph.has(rid)) viaConcept.set(rid, name);
  }

  const candidates = [...found, ...associated, ...viaConcept.keys()];
  const rows = d
    .prepare(
      `SELECT ch.rowid AS rid, ch.id, ch.document_id, ch.chapter_id, ch.chunk_index, ch.text,
              ch.start_page, ch.end_page,
              d.title  AS doc_title,
              d.short_code AS doc_short_code,
              c.number AS chapter_number,
              c.title  AS chapter_title
         FROM chunks ch
         JOIN documents d ON d.id = ch.document_id
         LEFT JOIN chapters c ON c.id = ch.chapter_id
        WHERE ch.rowid IN (${candidates.map(() => "?").join(",")})`
    )
    .all(...candidates) as Array<Omit<ChunkRow, "embedding"> & { rid: number; chunk_index: number }>;
  const byRid = new Map(rows.map((r) => [r.rid, r]));
  const ordered = candidates.map((rid) => byRid.get(rid)).filter((r): r is NonNullable<typeof r> => !!r);
  const order = await rerank(question, ordered.map((r) => r.text.slice(0, 2000)));
  // Mit Reranker entscheidet die Bewertung, wie viele Stellen mitgehen: bis zu 20 bei breiten Fragen,
  // mindestens 8; was weit unter dem besten Treffer liegt, bleibt draußen. Ohne Reranker feste Zahl
  const score = new Map<number, number>();
  let keep = TOP_K;
  if (order) {
    const top = order[0].score;
    order.forEach((o) => score.set(ordered[o.index].rid, top > 0 ? o.score / top : 0));
    keep = Math.min(MAX_HITS, Math.max(MIN_HITS, order.filter((o) => top > 0 && o.score / top >= KEEP_RATIO).length));
  }
  const ranked = (order ? order.map((o) => ordered[o.index]) : ordered).map((r) => r.rid);
  // Grundlagen treffen die Frage oft nicht wörtlich: zwei Plätze bleiben für sie reserviert
  const reserved = [...viaConcept.keys()].filter((rid) => !ranked.slice(0, keep - PREREQ_SLOTS).includes(rid)).slice(0, PREREQ_SLOTS);
  const rowids = [...ranked.filter((rid) => !reserved.includes(rid)).slice(0, keep - reserved.length), ...reserved];
  const sources = rowids
    .map((rid) => byRid.get(rid))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((row, i) => ({
      n: i + 1,
      docId: row.document_id,
      docTitle: row.doc_title,
      docShortCode: row.doc_short_code,
      chapterId: row.chapter_id,
      chapterNumber: row.chapter_number,
      chapterTitle: row.chapter_title,
      related: viaGraph.has(row.rid) || undefined,
      concept: viaConcept.get(row.rid),
      relevance: relevanceOf(score.get(row.rid)),
      startPage: row.start_page,
      endPage: row.end_page,
      // Die besten Treffer mit ihren Nachbarabschnitten: Definitionen und Herleitungen reißen sonst an der Abschnittsgrenze ab
      snippet: i < NEIGHBOR_HITS ? withNeighbors(row.document_id, row.chunk_index, row.text) : truncate(row.text, MAX_CHUNK_CHARS),
    }));
  return { sources, conceptNet: conceptNetText(active) };
}

const NEIGHBOR_HITS = 4;
const ASSOCIATION_SEEDS = 5;
const PREREQ_SLOTS = 2;

const RERANK_CANDIDATES = 40;
const MAX_HITS = 20;
const MIN_HITS = 8;
// Anteil an der Bewertung des besten Treffers, ab dem eine Stelle noch mitgeht
const KEEP_RATIO = 0.1;

// Stufe für Gemma: wie sicher die Stelle zur Frage passt
function relevanceOf(rel: number | undefined): TutorSource["relevance"] {
  if (rel === undefined) return undefined;
  return rel >= 0.5 ? "hoch" : rel >= 0.2 ? "mittel" : "niedrig";
}
const NEIGHBOR_CHARS = 600;

function withNeighbors(docId: string, index: number, text: string): string {
  const near = db()
    .prepare("SELECT chunk_index, text FROM chunks WHERE document_id = ? AND chunk_index IN (?, ?)")
    .all(docId, index - 1, index + 1) as Array<{ chunk_index: number; text: string }>;
  const prev = near.find((n) => n.chunk_index === index - 1)?.text ?? "";
  const next = near.find((n) => n.chunk_index === index + 1)?.text ?? "";
  return [prev && `… ${prev.slice(-NEIGHBOR_CHARS).trim()}`, truncate(text, MAX_CHUNK_CHARS), next && `${next.slice(0, NEIGHBOR_CHARS).trim()} …`]
    .filter(Boolean)
    .join("\n\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trim() + " …";
}

export function formatSourcesForPrompt(sources: TutorSource[]): string {
  return sources
    .map((s) => {
      if (s.grepId) return `[Quelle ${s.n}] Katalog-Eintrag ${s.grepId}\n${s.snippet}`;
      const heft = s.docShortCode
        ? `Heft „${s.docTitle}" (${s.docShortCode})`
        : `Heft „${s.docTitle}"`;
      const kapitel = s.chapterNumber
        ? `, Kapitel ${s.chapterNumber}${s.chapterTitle ? ` „${s.chapterTitle}"` : ""}`
        : "";
      const pages =
        s.startPage === s.endPage
          ? `, Seite ${s.startPage}`
          : `, Seiten ${s.startPage}–${s.endPage}`;
      const via = s.concept ? ` (Grundlage „${s.concept}“ aus dem Begriffsnetz)` : s.related ? " (verwandtes Kapitel aus den Zusammenhängen)" : "";
      const rel = s.relevance ? ` · Relevanz ${s.relevance}` : "";
      return `[Quelle ${s.n}] ${heft}${kapitel}${pages}${via}${rel}\n${s.snippet}`;
    })
    .join("\n\n---\n\n");
}
