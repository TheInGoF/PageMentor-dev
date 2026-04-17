import { join } from "path";
import { randomUUID } from "crypto";
import { db } from "../db";
import { extractPdf } from "./pdf";
import { stripBoilerplate } from "./clean";
import { detectChapters } from "./chapters";
import { emit } from "./events";
import { indexDocument, indexChapters } from "./search";
import { needsOcr, ocrPdfPages, renderCover } from "./ocr";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";

const running = new Set<string>();

export function isProcessing(docId: string): boolean {
  return running.has(docId);
}

export async function processDocument(docId: string): Promise<void> {
  if (running.has(docId)) return;
  running.add(docId);
  const d = db();
  const doc = d.prepare("SELECT * FROM documents WHERE id = ?").get(docId) as
    | { stored_path: string; language: string }
    | undefined;

  if (!doc) {
    running.delete(docId);
    return;
  }

  d.prepare("UPDATE documents SET ocr_status = 'running' WHERE id = ?").run(docId);
  emit({ phase: "pipeline.start", docId });

  try {
    const fullPath = join(DATA_DIR, doc.stored_path);
    emit({ phase: "pipeline.extract", docId, message: "Extrahiere PDF-Text" });
    const extracted = await extractPdf(fullPath);

    // OCR-Fallback: Bild-PDFs liefern pdf-parse leeren Text.
    let pages = extracted.pages;
    if (needsOcr(pages)) {
      emit({
        phase: "pipeline.extract",
        docId,
        message: "OCR: scannte PDF via tesseract",
      });
      pages = await ocrPdfPages({
        pdfPath: fullPath,
        language: doc.language || "en",
        pageCount: extracted.totalPages,
        fallback: pages,
      });
    }

    // Cover (erste PDF-Seite als JPG) im Hintergrund rendern.
    renderCover(fullPath, join(DATA_DIR, "covers"), docId).catch((err) =>
      console.warn("[pipeline] cover render failed:", err)
    );

    const cleanedPages = stripBoilerplate(pages);
    const fullText = cleanedPages.join("\n\n");

    d.prepare("UPDATE documents SET page_count = ?, ocr_text = ? WHERE id = ?").run(
      extracted.totalPages,
      fullText.slice(0, 5_000_000),
      docId
    );

    emit({
      phase: "pipeline.chapters",
      docId,
      message: `Erkenne Kapitel aus ${extracted.totalPages} Seiten`,
    });
    const chapters = detectChapters(cleanedPages);

    const tx = d.transaction(() => {
      d.prepare("DELETE FROM chapters WHERE document_id = ?").run(docId);
      const insert = d.prepare(
        "INSERT INTO chapters (id, document_id, number, title, start_page, end_page, text, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      chapters.forEach((ch, idx) => {
        insert.run(randomUUID(), docId, ch.number, ch.title, ch.startPage, ch.endPage, ch.text, idx);
      });
    });
    tx();

    d.prepare("UPDATE documents SET ocr_status = 'done' WHERE id = ?").run(docId);

    // Fire-and-forget: Meilisearch-Indexierung. Fehler werden intern geloggt.
    try {
      const fullDoc = d
        .prepare(
          `SELECT d.id, d.title, d.filename, d.type, d.language, d.page_count, d.created_at,
                  GROUP_CONCAT(t.label) as tags
           FROM documents d
           LEFT JOIN document_tags dt ON dt.document_id = d.id
           LEFT JOIN tags t ON t.id = dt.tag_id
           WHERE d.id = ?
           GROUP BY d.id`
        )
        .get(docId) as any;
      if (fullDoc) {
        indexDocument({
          id: fullDoc.id,
          title: fullDoc.title,
          filename: fullDoc.filename,
          type: fullDoc.type,
          tags: fullDoc.tags ? String(fullDoc.tags).split(",") : [],
          language: fullDoc.language,
          ocr_text: fullText,
          page_count: fullDoc.page_count,
          created_at: fullDoc.created_at,
        });
      }
      const chapterRows = d
        .prepare(
          "SELECT id, document_id, number, title, text FROM chapters WHERE document_id = ? ORDER BY number"
        )
        .all(docId) as any[];
      if (chapterRows.length > 0 && fullDoc) {
        indexChapters(
          chapterRows.map((ch) => ({
            id: ch.id,
            document_id: ch.document_id,
            document_title: fullDoc.title,
            number: ch.number,
            title: ch.title,
            text: ch.text,
          }))
        );
      }
    } catch (indexErr) {
      console.warn("[pipeline] indexing failed:", indexErr);
    }

    emit({
      phase: "pipeline.done",
      docId,
      total: chapters.length,
      message: `${extracted.totalPages} Seiten, ${chapters.length} Kapitel`,
    });
    console.log(
      `[pipeline] ${docId}: ${extracted.totalPages} pages → ${chapters.length} chapters`
    );
  } catch (err) {
    console.error(`[pipeline] ${docId} failed:`, err);
    d.prepare("UPDATE documents SET ocr_status = 'failed' WHERE id = ?").run(docId);
    emit({
      phase: "pipeline.failed",
      docId,
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running.delete(docId);
  }
}
