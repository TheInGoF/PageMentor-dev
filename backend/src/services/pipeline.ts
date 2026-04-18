import { join } from "path";
import { randomUUID } from "crypto";
import { db } from "../db";
import { extractPdfViaDocling, doclingAlive } from "./docling";
import { cleanForReading } from "./clean";
import { emit } from "./events";
import { indexDocument, indexChapters } from "./search";
import { renderCover } from "./ocr";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";

const running = new Map<string, AbortController>();

export function isProcessing(docId: string): boolean {
  return running.has(docId);
}

export function cancelProcessing(docId: string): boolean {
  const ctrl = running.get(docId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/**
 * Extrahiert die PDF via docling-serve, schreibt Kapitel in die DB und
 * stößt die Meilisearch-Indexierung an. Wird manuell vom User über
 * /api/documents/:id/reprocess ausgelöst — der Upload legt das Dokument
 * nur mit Status `awaiting-extraction` an, ohne Pipeline zu starten.
 */
export async function processDocument(docId: string): Promise<void> {
  if (running.has(docId)) return;
  const abortController = new AbortController();
  running.set(docId, abortController);
  const signal = abortController.signal;

  const d = db();
  const doc = d.prepare("SELECT * FROM documents WHERE id = ?").get(docId) as
    | { stored_path: string; language: string }
    | undefined;

  if (!doc) {
    running.delete(docId);
    return;
  }

  d.prepare(
    "UPDATE documents SET ocr_status = 'running', extraction_started_at = ? WHERE id = ?"
  ).run(Date.now(), docId);
  emit({ phase: "pipeline.start", docId });

  try {
    const fullPath = join(DATA_DIR, doc.stored_path);

    emit({ phase: "pipeline.extraction", docId, message: "Docling-Verbindung prüfen …" });
    if (!(await doclingAlive())) {
      throw new Error(
        "docling-serve nicht erreichbar. Läuft der docling-Container?"
      );
    }

    emit({ phase: "pipeline.extraction", docId, message: "Docling: PDF hochladen …" });
    const extraction = await extractPdfViaDocling({
      pdfPath: fullPath,
      language: doc.language,
      signal,
      onProgress: (message, fraction) =>
        emit({ phase: "pipeline.extraction", docId, message, current: fraction }),
    });

    // Cover-Thumb (erste Seite als JPG) im Hintergrund rendern —
    // nutzt poppler, nicht docling, weil docling kein Bild liefert.
    renderCover(fullPath, join(DATA_DIR, "covers"), docId).catch((err) =>
      console.warn("[pipeline] cover render failed:", err)
    );

    // Paranoid-Post-Pass: Docling macht das meiste schon, aber ein
    // Edge-Case-XML-Steuerzeichen oder Ligatur durch die Hintertür
    // lassen wir nicht im Kapiteltext landen.
    const cleanedSections = extraction.sections.map((s) => ({
      ...s,
      text: cleanForReading(s.text),
    }));

    const fullText = cleanedSections.map((s) => s.text).join("\n\n");

    d.prepare(
      "UPDATE documents SET page_count = ?, ocr_text = ? WHERE id = ?"
    ).run(extraction.pageCount, fullText.slice(0, 5_000_000), docId);

    emit({
      phase: "pipeline.chapters",
      docId,
      message: `${cleanedSections.length} Kapitel`,
    });

    const tx = d.transaction(() => {
      d.prepare("DELETE FROM chapters WHERE document_id = ?").run(docId);
      const insert = d.prepare(
        "INSERT INTO chapters (id, document_id, number, title, start_page, end_page, text, sort_order, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      cleanedSections.forEach((ch, idx) => {
        insert.run(
          randomUUID(),
          docId,
          ch.number,
          ch.title,
          ch.startPage,
          ch.endPage,
          ch.text,
          idx,
          ch.kind
        );
      });
    });
    tx();

    d.prepare(
      "UPDATE documents SET ocr_status = 'done', extraction_started_at = NULL WHERE id = ?"
    ).run(docId);

    // Fire-and-forget: Meilisearch-Indexierung.
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
      total: cleanedSections.length,
      message: `${extraction.pageCount} Seiten, ${cleanedSections.length} Kapitel`,
    });
    console.log(
      `[pipeline] ${docId}: docling → ${extraction.pageCount} pages, ${cleanedSections.length} chapters`
    );
  } catch (err) {
    console.error(`[pipeline] ${docId} failed:`, err);
    d.prepare(
      "UPDATE documents SET ocr_status = 'failed', extraction_started_at = NULL WHERE id = ?"
    ).run(docId);
    emit({
      phase: "pipeline.failed",
      docId,
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running.delete(docId);
  }
}
