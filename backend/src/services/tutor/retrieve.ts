// Passende Textstücke für eine Frage finden
import { db } from "../../db";
import { resolveEmbedder, embedText, embeddingFromBuffer, cosineSim } from "../embeddings";
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
  const embedder = await resolveEmbedder();
  if (!embedder) throw new Error("embedder_unreachable");
  const qVec = await embedText(question, embedder, "query");

  // Alle Chunks im Bereich: ganze Bibliothek oder ein Modul
  const params: string[] = [];
  let where = "";
  if (moduleId) {
    where = "WHERE d.module_id = ?";
    params.push(moduleId);
  }
  const rows = db()
    .prepare(
      `SELECT ch.id, ch.document_id, ch.chapter_id, ch.text,
              ch.start_page, ch.end_page, ch.embedding,
              d.title  AS doc_title,
              d.short_code AS doc_short_code,
              c.number AS chapter_number,
              c.title  AS chapter_title
         FROM chunks ch
         JOIN documents d ON d.id = ch.document_id
         LEFT JOIN chapters c ON c.id = ch.chapter_id
         ${where}`
    )
    .all(...params) as ChunkRow[];

  const scored: Array<{ row: ChunkRow; score: number }> = [];
  for (const row of rows) {
    if (!row.embedding) continue;
    const vec = embeddingFromBuffer(row.embedding);
    if (vec.length !== qVec.length) continue;
    scored.push({ row, score: cosineSim(qVec, vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_K);

  return top.map((s, i) => ({
    n: i + 1,
    docId: s.row.document_id,
    docTitle: s.row.doc_title,
    docShortCode: s.row.doc_short_code,
    chapterId: s.row.chapter_id,
    chapterNumber: s.row.chapter_number,
    chapterTitle: s.row.chapter_title,
    startPage: s.row.start_page,
    endPage: s.row.end_page,
    snippet: truncate(s.row.text, MAX_CHUNK_CHARS),
  }));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trim() + " …";
}

export function formatSourcesForPrompt(sources: TutorSource[]): string {
  return sources
    .map((s) => {
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
