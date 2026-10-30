import { join } from "path";
import { isIncluded } from "./audiobook/state";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { db } from "../db";
import { extractPdfViaDocling, doclingAlive } from "./docling";
import { assignAfterExtraction } from "../study/assign/store";
import { emitLog } from "../log/logger";
import { syncVectors } from "./rag/vec";
import { extractionFromMarkdown } from "./batch/markdown";
import { describeDuplicate, findTextDuplicate, markdownPlainText, textMinhash } from "./batch/dedupe";
import { writeKnowledgeFolder } from "./batch/knowledgeFolder";
import type { DoclingExtraction } from "./docling/types";
import { extractPdf } from "./pdf";
import { withDocling } from "./docling/release";
import { cleanForReading } from "./clean";
import { emit } from "./events";
import { indexDocument, indexChapters } from "./search";
import { renderCover } from "./ocr";
import { chunkChapters, type Chunk } from "./chunker";
import {
  resolveEmbedder,
  embedText,
  embeddingToBuffer,
} from "./embeddings";
import { pickLang, tLang } from "../lib/i18n";
import { DATA_DIR, fromDataPath } from "../paths";
import { runJob } from "../log/jobs";


const running = new Map<string, AbortController>();

export function isProcessing(docId: string): boolean {
  return running.has(docId);
}

export function anyProcessing(): boolean {
  return running.size > 0;
}

export function cancelProcessing(docId: string): boolean {
  const ctrl = running.get(docId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/**
 * Extracts the PDF via docling-serve, writes chapters to the DB and
 * kicks off Meilisearch indexing. Triggered manually by the user via
 * /api/documents/:id/reprocess — upload only creates the document
 * with status `awaiting-extraction` without starting the pipeline.
 */
async function processDocumentImpl(docId: string): Promise<void> {
  if (running.has(docId)) return;
  const abortController = new AbortController();
  running.set(docId, abortController);
  const signal = abortController.signal;

  const d = db();
  const doc = d.prepare("SELECT * FROM documents WHERE id = ?").get(docId) as
    | { stored_path: string; language: string; force_ocr: number; filename: string; source_md: string | null }
    | undefined;

  if (!doc) {
    running.delete(docId);
    return;
  }

  const lang = pickLang(doc.language);

  d.prepare(
    "UPDATE documents SET ocr_status = 'running', extraction_started_at = ? WHERE id = ?"
  ).run(Date.now(), docId);
  emit({ phase: "pipeline.start", docId });

  try {
    const fullPath = fromDataPath(doc.stored_path);

    // Vorhandenes Docling-Markdown (Stapel-Import) übernehmen statt neu umzuwandeln
    const adopted = doc.source_md && existsSync(doc.source_md) ? readFileSync(doc.source_md, "utf8") : null;
    let extraction: DoclingExtraction;
    if (adopted) {
      const pages = await extractPdf(fullPath).then((p) => p.totalPages).catch(() => 0);
      extraction = extractionFromMarkdown(adopted, pages);
      emit({ phase: "pipeline.extraction", docId, message: "Docling-Markdown übernommen" });
    } else {
      emit({ phase: "pipeline.extraction", docId, message: tLang(lang, "msg.doclingChecking") });
      // Wartet einen laufenden Docling-Neustart (Grafikspeicher freigeben) ab
      extraction = await withDocling(async () => {
        if (!(await doclingAlive())) {
          throw new Error(tLang(lang, "err.doclingUnreachable"));
        }

        emit({ phase: "pipeline.extraction", docId, message: tLang(lang, "msg.doclingUploading") });
        return extractPdfViaDocling({
          pdfPath: fullPath,
          language: doc.language,
          forceOcr: doc.force_ocr === 1,
          signal,
          onProgress: (message, fraction) =>
            emit({ phase: "pipeline.extraction", docId, message, current: fraction }),
        });
      });
    }

    // Dubletten vor Kapiteln, Embeddings und KI: bei Scans gibt es erst jetzt Text zum Vergleichen
    const known = d.prepare("SELECT text_minhash FROM documents WHERE id = ?").get(docId) as { text_minhash: string | null } | null;
    if (!known?.text_minhash) {
      const hash = textMinhash(markdownPlainText(extraction.markdown));
      if (hash) {
        d.prepare("UPDATE documents SET text_minhash = ? WHERE id = ?").run(JSON.stringify(hash), docId);
        const dup = findTextDuplicate(hash, docId);
        const fromQueue = d.prepare("SELECT 1 FROM import_queue WHERE document_id = ?").get(docId);
        if (dup && fromQueue) {
          d.prepare("UPDATE documents SET ocr_status = 'duplicate', duplicate_of = ?, extraction_started_at = NULL WHERE id = ?").run(dup.documentId, docId);
          emit({ phase: "pipeline.done", docId, message: describeDuplicate(dup) });
          return;
        }
        if (dup) emitLog("warn", "pipeline", describeDuplicate(dup), { ctx: { docId } });
      }
    }

    // Render cover thumb (first page as JPG) in the background —
    // uses poppler, not docling, because docling doesn't return an image.
    renderCover(fullPath, join(DATA_DIR, "covers"), docId).catch((err) =>
      console.warn("[pipeline] cover render failed:", err)
    );

    // Paranoid post-pass: Docling does most of the work, but we don't
    // want an edge-case XML control character or ligature sneaking
    // through the back door into the chapter text.
    const cleanedSections = extraction.sections.map((s) => ({
      ...s,
      text: cleanForReading(s.text),
    }));

    const fullText = cleanedSections.map((s) => s.text).join("\n\n");

    // Persist title + author from Docling metadata. We only overwrite
    // `title` (UI-visible) if the current value is still the
    // auto-derived-from-filename one — once the user has edited it
    // in the UI, we leave it alone.
    const docMetaTitle = extraction.metadata.title;
    const docMetaAuthor = extraction.metadata.author;
    if (docMetaTitle || docMetaAuthor) {
      d.prepare(
        "UPDATE documents SET page_count = ?, ocr_text = ?, doc_title = COALESCE(?, doc_title), author = COALESCE(?, author) WHERE id = ?"
      ).run(
        extraction.pageCount,
        fullText.slice(0, 5_000_000),
        docMetaTitle,
        docMetaAuthor,
        docId
      );
    } else {
      d.prepare(
        "UPDATE documents SET page_count = ?, ocr_text = ? WHERE id = ?"
      ).run(extraction.pageCount, fullText.slice(0, 5_000_000), docId);
    }

    emit({
      phase: "pipeline.chapters",
      docId,
      message: tLang(lang, "msg.chaptersCount", { count: cleanedSections.length }),
    });

    const tx = d.transaction(() => {
      d.prepare("DELETE FROM chapters WHERE document_id = ?").run(docId);
      const insert = d.prepare(
        "INSERT INTO chapters (id, document_id, number, title, start_page, end_page, text, sort_order, kind, include_in_audio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
          ch.kind,
          // Standard je Kapitelart wie im Hörbuch (Inhalt, Zusammenfassung, Vorwort/Einleitung an)
          isIncluded({ kind: ch.kind, include_in_audio: null }) ? 1 : 0
        );
      });
    });
    tx();

    d.prepare(
      "UPDATE documents SET ocr_status = 'done', extraction_started_at = NULL WHERE id = ?"
    ).run(docId);

    // Artifact dump: full Markdown + DoclingDocument JSON to disk so
    // we can inspect on demand and future RAG/layout features can
    // work directly on it.
    try {
      writeDoclingArtifacts(docId, extraction.markdown, extraction.docJson);
    } catch (err) {
      console.warn("[pipeline] artifact dump failed:", err);
    }

    // Chunking + DB insert + embedding. Embedding errors don't block
    // extraction completion — chunks then sit without vectors and can
    // be re-embedded later when Ollama is online again.
    try {
      await buildChunksForDocument(docId);
    } catch (err) {
      console.warn("[pipeline] chunking failed:", err);
    }

    // Fire-and-forget: Meilisearch indexing.
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

    // Qualität prüfen, Modul nur mit Beleg zuordnen, sonst Vorschlag unter „Ohne Modul“
    try {
      const r = assignAfterExtraction(docId, doc.filename, extraction.markdown, extraction.pageCount);
      const c = r.classification;
      emitLog("info", "pipeline", `Zuordnung ${c.code ?? "ohne Modul"} (${c.rule}, ${r.assigned ? "automatisch" : "Vorschlag"})`, { ctx: { docId } });
      if (r.quality.flag) emitLog("warn", "pipeline", `Qualität prüfen: ${r.quality.reasons.join("; ")}`, { ctx: { docId } });
    } catch (assignErr) {
      emitLog("warn", "pipeline", "Zuordnung fehlgeschlagen", { ctx: { docId }, err: assignErr });
    }

    // Lesbare Ablage in der Wissensdatenbank, nach der Zuordnung, damit das Modul drinsteht
    try {
      writeKnowledgeFolder(docId, extraction.markdown, extraction.images, adopted ? doc.source_md : null);
    } catch (err) {
      emitLog("warn", "pipeline", "Ablage in der Wissensdatenbank fehlgeschlagen", { ctx: { docId }, err });
    }

    emit({
      phase: "pipeline.done",
      docId,
      total: cleanedSections.length,
      message: tLang(lang, "msg.pagesAndChapters", {
        pages: extraction.pageCount,
        count: cleanedSections.length,
      }),
    });
    console.log(
      `[pipeline] ${docId}: docling → ${extraction.pageCount} pages, ${cleanedSections.length} chapters`
    );
  } catch (err) {
    // logTap.installLogTap only spreads strings — passing an Error
    // object printed "{}" in the Logs page (same issue we hit in
    // cards/preprocess). Serialise the stack so it's actually
    // diagnosable.
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? msg : msg;
    console.error(`[pipeline] ${docId} failed: ${stack}`);
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

/** Writes the raw Markdown + DoclingDocument JSON to the document's
 *  upload directory. Only for debug/inspection + future re-processing
 *  scenarios — not consumed elsewhere. */
function writeDoclingArtifacts(
  docId: string,
  markdown: string,
  docJson: unknown | null
): void {
  const uploadDir = join(DATA_DIR, "uploads", docId);
  const dir = join(uploadDir, "docling");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "full.md"), markdown);
  if (docJson) {
    writeFileSync(join(dir, "document.json"), JSON.stringify(docJson, null, 2));
  }
}

/** Chunks the current chapters of a document, writes them as JSON
 *  files to disk, persists them in the chunks table and generates
 *  (best-effort) embeddings via Ollama. */
async function buildChunksForDocument(docId: string): Promise<void> {
  const d = db();
  const chapters = d
    .prepare(
      "SELECT id, number, title, text, start_page, end_page, kind FROM chapters WHERE document_id = ? ORDER BY sort_order ASC, number ASC"
    )
    .all(docId) as Array<{
      id: string;
      number: number;
      title: string;
      text: string;
      start_page: number;
      end_page: number;
      kind: string;
    }>;

  if (chapters.length === 0) return;

  const chunks = chunkChapters(
    chapters.map((c) => ({
      id: c.id,
      number: c.number,
      title: c.title,
      text: c.text,
      start_page: c.start_page,
      end_page: c.end_page,
      kind: c.kind,
    })),
    { targetTokens: 800, overlapTokens: 100 }
  );

  const chunksDir = join(DATA_DIR, "uploads", docId, "docling", "chunks");
  mkdirSync(chunksDir, { recursive: true });

  // DB: clear existing chunks for the document, then re-insert.
  const insertChunk = d.prepare(
    `INSERT INTO chunks (id, document_id, chapter_id, chunk_index, text, start_page, end_page, embedding, embedding_model)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
  );
  const tx = d.transaction((rows: Array<{ chunk: Chunk; id: string }>) => {
    d.prepare("DELETE FROM chunks WHERE document_id = ?").run(docId);
    for (const { chunk, id } of rows) {
      insertChunk.run(
        id,
        docId,
        chunk.chapter_id,
        chunk.chunk_index,
        chunk.text,
        chunk.start_page,
        chunk.end_page
      );
    }
  });

  const withIds = chunks.map((chunk) => ({ chunk, id: randomUUID() }));
  tx(withIds);

  // Chunks on disk — one file per chunk, numerically sorted.
  for (const { chunk, id } of withIds) {
    const name = String(chunk.chunk_index).padStart(4, "0") + ".json";
    const payload = {
      id,
      doc_id: docId,
      ...chunk,
    };
    writeFileSync(join(chunksDir, name), JSON.stringify(payload, null, 2));
  }

  console.log(
    `[pipeline] ${docId}: ${chunks.length} chunks written to disk + DB`
  );

  // Embeddings — best-effort. Ollama can be offline, model not
  // installed, etc. In both cases chunks stay in the DB as text only,
  // without vectors; the RAG query then falls back to text-only.
  const embedder = await resolveEmbedder();
  if (!embedder) {
    console.log(
      `[pipeline] ${docId}: TEI embedding server unreachable — chunks stored without vectors.`
    );
    return;
  }

  let okCount = 0;
  let failCount = 0;
  const updateEmbedding = d.prepare(
    "UPDATE chunks SET embedding = ?, embedding_model = ? WHERE id = ?"
  );
  for (const { chunk, id } of withIds) {
    try {
      const emb = await embedText(chunk.text, embedder, "passage");
      updateEmbedding.run(embeddingToBuffer(emb), embedder.model, id);
      okCount++;
    } catch (err) {
      failCount++;
      if (failCount === 1) {
        console.warn(
          `[pipeline] ${docId}: first embedding failed — ${(err as Error).message}`
        );
      }
    }
  }
  console.log(
    `[pipeline] ${docId}: ${okCount}/${withIds.length} Chunks embedded (${embedder.model})`
  );
  // Neue Vektoren in den Suchindex
  syncVectors(d);
}

export function processDocument(...args: Parameters<typeof processDocumentImpl>): ReturnType<typeof processDocumentImpl> {
  return runJob("extract", "pipeline", { docId: args[0] }, () => processDocumentImpl(...args));
}
