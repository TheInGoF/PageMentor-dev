// Katalog-Einträge für den Tutor: exakte Grep-ID oder Wortübereinstimmung (schnell, ohne Engine)
// Die hybride Suche mit Vektoren kommt mit der Wissensdatenbank (Phase K)
import { db } from "../../db";
import type { TutorSource } from "./types";

export interface MaterialHit {
  id: string;
  kind: string;
  title: string;
  body_md: string;
  source_document_id: string | null;
  source_ref: string | null;
  doc_title: string | null;
  doc_short_code: string | null;
  score: number;
}

const GREP_ID = /\b[A-Z][A-Z0-9]{1,15}-[ARMF]-[A-Z0-9][A-Z0-9_-]*/g;
const STOP = new Set("der die das und oder ist sind ein eine einer eines wie was wann warum welche welcher mit von für auf aus bei den dem des nicht auch noch nur wird werden kann man ich mir mich dich the and for what how why".split(" "));

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-zäöüß0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w));
}

// Treffer im Titel zählen doppelt; lange Einträge werden nicht bevorzugt
export function scoreItem(query: string[], title: string, body: string): number {
  if (!query.length) return 0;
  const t = new Set(tokens(title));
  const b = new Set(tokens(body));
  let s = 0;
  for (const q of new Set(query)) s += (t.has(q) ? 2 : 0) + (b.has(q) ? 1 : 0);
  return s / Math.sqrt(1 + b.size / 40);
}

export function retrieveMaterial(question: string, moduleId: string | null, limit = 4): MaterialHit[] {
  const where = moduleId ? "WHERE m.module_id = ?" : "";
  const rows = db()
    .prepare(
      `SELECT m.id, m.kind, m.title, m.body_md, m.source_document_id, m.source_ref, d.title AS doc_title, d.short_code AS doc_short_code
         FROM material_items m LEFT JOIN documents d ON d.id = m.source_document_id ${where}`
    )
    .all(...(moduleId ? [moduleId] : [])) as Omit<MaterialHit, "score">[];
  const ids = new Set((question.toUpperCase().match(GREP_ID) ?? []).map((x) => x.toUpperCase()));
  const q = tokens(question);
  return rows
    .map((r) => ({ ...r, score: ids.has(r.id) ? 1000 : scoreItem(q, r.title, r.body_md) }))
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Seitenzahl aus „S. 14“ oder „Seite 14“, sonst Seite 1
function page(ref: string | null): number {
  const m = /(?:S\.|Seite)\s*(\d+)/i.exec(ref ?? "");
  return m ? Number(m[1]) : 1;
}

export function materialSources(hits: MaterialHit[], startAt: number): TutorSource[] {
  return hits.map((h, i) => ({
    n: startAt + i,
    docId: h.source_document_id ?? "",
    docTitle: h.doc_title ?? h.title,
    docShortCode: h.doc_short_code,
    chapterId: null,
    chapterNumber: null,
    chapterTitle: null,
    startPage: page(h.source_ref),
    endPage: page(h.source_ref),
    snippet: `${h.title}\n${h.body_md}`.slice(0, 1200),
    grepId: h.id,
  }));
}
