import { join } from "path";
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { db } from "../db";
import { extractPdfViaDocling, doclingAlive } from "./docling";
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

    // Titel + Autor aus Docling-Metadaten persistieren. `title` (UI-
    // sichtbar) überschreiben wir nur wenn der aktuelle Wert noch der
    // automatisch-aus-Filename-abgeleitete ist — sobald der User in
    // der UI editiert hat, lassen wir's stehen.
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
      message: `${cleanedSections.length} Kapitel`,
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
          // Default: content + summary kommen ins Hörbuch, alles andere
          // (Beispiele, Übungen, Verzeichnisse, Lösungen, …) erstmal
          // raus. User kann pro Kapitel einzeln umschalten.
          ch.kind === "content" || ch.kind === "summary" ? 1 : 0
        );
      });
    });
    tx();

    d.prepare(
      "UPDATE documents SET ocr_status = 'done', extraction_started_at = NULL WHERE id = ?"
    ).run(docId);

    // Artefakt-Dump: komplettes Markdown + DoclingDocument-JSON auf Disk,
    // damit man bei Bedarf reinschauen kann und spätere RAG-/Layout-
    // Features direkt darauf arbeiten können.
    try {
      writeDoclingArtifacts(docId, extraction.markdown, extraction.docJson);
    } catch (err) {
      console.warn("[pipeline] artifact dump failed:", err);
    }

    // Chunking + DB-Insert + Embedding. Embedding-Fehler blockieren den
    // Extraktions-Abschluss nicht — Chunks stehen dann ohne Vektoren da
    // und können später nachembedded werden wenn Ollama wieder online ist.
    try {
      await buildChunksForDocument(docId);
    } catch (err) {
      console.warn("[pipeline] chunking failed:", err);
    }

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

/** Schreibt das rohe Markdown + die DoclingDocument-JSON in das
 *  Upload-Verzeichnis des Dokuments. Nur für Debug/Inspection +
 *  zukünftige Re-Processing-Szenarien — wird nicht weiterverwendet. */
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

/** Chunked die aktuellen Kapitel eines Dokuments, schreibt sie als
 *  JSON-Files auf Disk, persistiert sie in der chunks-Tabelle und
 *  generiert (best-effort) Embeddings via Ollama. */
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

  // DB: vorhandene Chunks für das Dokument wegräumen, dann neu einfügen.
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

  // Chunks auf Disk — ein File pro Chunk, numerisch sortiert.
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

  // Embeddings — best-effort. Ollama kann offline sein, Modell nicht
  // installiert, etc. In beiden Fällen bleiben die Chunks als Text in
  // der DB stehen, nur ohne Vektoren; der RAG-Query fällt dann zurück
  // auf Text-only.
  const embedder = await resolveEmbedder();
  if (!embedder) {
    console.log(
      `[pipeline] ${docId}: kein Ollama für Embeddings erreichbar — Chunks ohne Vektoren.`
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
      const emb = await embedText(chunk.text, embedder);
      updateEmbedding.run(embeddingToBuffer(emb), embedder.model, id);
      okCount++;
    } catch (err) {
      failCount++;
      if (failCount === 1) {
        console.warn(
          `[pipeline] ${docId}: erstes Embedding fehlgeschlagen — ${(err as Error).message}`
        );
      }
    }
  }
  console.log(
    `[pipeline] ${docId}: ${okCount}/${withIds.length} Chunks embedded (${embedder.model})`
  );
}
