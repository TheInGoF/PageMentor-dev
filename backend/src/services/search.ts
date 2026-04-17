/**
 * Meilisearch-Integration.
 *
 * Zwei Indices:
 *   - "pm_documents"  : Metadaten + OCR-Text; searchable auf Titel, Tags, Text
 *   - "pm_chapters"   : pro Kapitel Text + Titel; filterable nach Dokument
 *
 * Fehlschlagende Meilisearch-Calls blockieren die Pipeline NICHT — sie werden
 * nur geloggt. So bleibt PageMentor auch ohne laufenden Meilisearch-Container
 * benutzbar (dann halt ohne Suche).
 */

import { Meilisearch } from "meilisearch";

const MEILI_URL = process.env.MEILI_URL || "http://localhost:7700";
const MEILI_KEY = process.env.MEILI_MASTER_KEY || "pm-dev-key";

const DOC_INDEX = "pm_documents";
const CHAPTER_INDEX = "pm_chapters";

let client: Meilisearch | null = null;
let ready = false;
let readyPromise: Promise<boolean> | null = null;

export function isReady(): boolean {
  return ready;
}

function getClient(): Meilisearch {
  if (!client) {
    client = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
  }
  return client;
}

export async function ensureReady(): Promise<boolean> {
  if (ready) return true;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    try {
      const c = getClient();
      await c.health();
      await c.createIndex(DOC_INDEX, { primaryKey: "id" }).catch(() => {});
      await c.createIndex(CHAPTER_INDEX, { primaryKey: "id" }).catch(() => {});

      const docIdx = c.index(DOC_INDEX);
      await docIdx.updateSearchableAttributes(["title", "tags", "ocr_text", "filename"]);
      await docIdx.updateFilterableAttributes(["type", "tags", "language"]);
      await docIdx.updateSortableAttributes(["created_at"]);

      const chIdx = c.index(CHAPTER_INDEX);
      await chIdx.updateSearchableAttributes(["title", "text", "document_title"]);
      await chIdx.updateFilterableAttributes(["document_id"]);
      await chIdx.updateSortableAttributes(["number"]);

      ready = true;
      console.log(`[search] Meilisearch ready at ${MEILI_URL}`);
      return true;
    } catch (err) {
      console.warn(
        `[search] Meilisearch unavailable at ${MEILI_URL} — search disabled:`,
        err instanceof Error ? err.message : err
      );
      ready = false;
      return false;
    } finally {
      readyPromise = null;
    }
  })();

  return readyPromise;
}

export interface IndexedDocument {
  id: string;
  title: string;
  filename: string;
  type: string;
  tags: string[];
  language: string;
  ocr_text: string;
  page_count: number;
  created_at: string;
}

export interface IndexedChapter {
  id: string;
  document_id: string;
  document_title: string;
  number: number;
  title: string;
  text: string;
}

export async function indexDocument(doc: IndexedDocument): Promise<void> {
  if (!(await ensureReady())) return;
  try {
    // Cap text length — Meilisearch is happy with long docs but we don't want 50 MB payloads
    await getClient()
      .index(DOC_INDEX)
      .addDocuments([{ ...doc, ocr_text: (doc.ocr_text || "").slice(0, 500_000) }]);
  } catch (err) {
    console.warn("[search] indexDocument failed:", err);
  }
}

export async function indexChapters(chapters: IndexedChapter[]): Promise<void> {
  if (chapters.length === 0) return;
  if (!(await ensureReady())) return;
  try {
    await getClient()
      .index(CHAPTER_INDEX)
      .addDocuments(
        chapters.map((ch) => ({ ...ch, text: (ch.text || "").slice(0, 200_000) }))
      );
  } catch (err) {
    console.warn("[search] indexChapters failed:", err);
  }
}

export async function removeDocument(docId: string): Promise<void> {
  if (!(await ensureReady())) return;
  try {
    const c = getClient();
    await c.index(DOC_INDEX).deleteDocument(docId);
    await c.index(CHAPTER_INDEX).deleteDocuments({ filter: `document_id = "${docId}"` });
  } catch (err) {
    console.warn("[search] removeDocument failed:", err);
  }
}

export interface SearchResult {
  documents: Array<{
    id: string;
    title: string;
    filename: string;
    type: string;
    tags: string[];
    language: string;
    page_count: number;
    snippet: string | null;
  }>;
  chapters: Array<{
    id: string;
    document_id: string;
    document_title: string;
    number: number;
    title: string;
    snippet: string | null;
  }>;
  enabled: boolean;
}

export async function search(query: string, limit = 10): Promise<SearchResult> {
  if (!(await ensureReady())) {
    return { documents: [], chapters: [], enabled: false };
  }
  try {
    const c = getClient();
    const [docs, chs] = await Promise.all([
      c.index(DOC_INDEX).search(query, {
        limit,
        attributesToCrop: ["ocr_text"],
        cropLength: 30,
        attributesToHighlight: ["title", "ocr_text"],
        highlightPreTag: "«",
        highlightPostTag: "»",
      }),
      c.index(CHAPTER_INDEX).search(query, {
        limit: limit * 2,
        attributesToCrop: ["text"],
        cropLength: 30,
        attributesToHighlight: ["title", "text"],
        highlightPreTag: "«",
        highlightPostTag: "»",
      }),
    ]);

    return {
      enabled: true,
      documents: (docs.hits as any[]).map((h) => ({
        id: h.id,
        title: h._formatted?.title ?? h.title,
        filename: h.filename,
        type: h.type,
        tags: h.tags ?? [],
        language: h.language,
        page_count: h.page_count,
        snippet: h._formatted?.ocr_text ?? null,
      })),
      chapters: (chs.hits as any[]).map((h) => ({
        id: h.id,
        document_id: h.document_id,
        document_title: h.document_title,
        number: h.number,
        title: h._formatted?.title ?? h.title,
        snippet: h._formatted?.text ?? null,
      })),
    };
  } catch (err) {
    console.warn("[search] search failed:", err);
    return { documents: [], chapters: [], enabled: false };
  }
}
