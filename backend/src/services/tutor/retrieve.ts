// Passende Textstücke für eine Frage finden
import { db } from "../../db";
import { hybridSearch } from "../rag/hybrid";
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

export async function retrieveChunks(
  question: string,
  moduleId: string | null
): Promise<TutorSource[]> {
  // Volltext und Vektoren gemeinsam; ohne Embedder bleibt die Volltextsuche
  const { rowids } = await hybridSearch(question, moduleId, TOP_K);
  if (!rowids.length) return [];
  const rows = db()
    .prepare(
      `SELECT ch.rowid AS rid, ch.id, ch.document_id, ch.chapter_id, ch.text,
              ch.start_page, ch.end_page,
              d.title  AS doc_title,
              d.short_code AS doc_short_code,
              c.number AS chapter_number,
              c.title  AS chapter_title
         FROM chunks ch
         JOIN documents d ON d.id = ch.document_id
         LEFT JOIN chapters c ON c.id = ch.chapter_id
        WHERE ch.rowid IN (${rowids.map(() => "?").join(",")})`
    )
    .all(...rowids) as Array<Omit<ChunkRow, "embedding"> & { rid: number }>;
  const byRid = new Map(rows.map((r) => [r.rid, r]));
  return rowids
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
      startPage: row.start_page,
      endPage: row.end_page,
      snippet: truncate(row.text, MAX_CHUNK_CHARS),
    }));
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
      return `[Quelle ${s.n}] ${heft}${kapitel}${pages}\n${s.snippet}`;
    })
    .join("\n\n---\n\n");
}
