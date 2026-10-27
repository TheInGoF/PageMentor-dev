// Konfiguration und Typen für docling-serve

export const DOCLING_URL = process.env.PM_DOCLING_URL || `http://${process.env.PM_ENGINE_HOST || "localhost"}:5001`;
export const DOCLING_API_KEY = process.env.PM_DOCLING_API_KEY || "";
export const POLL_INTERVAL_MS = 4000;

// Art eines Abschnitts, steuert die Verwendung
// content: Hörbuch, Karten, Zusammenfassung · example: Karten, kein Hörbuch
// exercise: Prüfungspool · summary: gut fürs Hörbuch · self_check, solutions
// index: Verzeichnisse · references: Literatur · meta: Vorwort, Impressum · other: unklar
export type ChapterKind =
  | "content"
  | "example"
  | "exercise"
  | "summary"
  | "self_check"
  | "solutions"
  | "index"
  | "references"
  | "meta"
  | "other";

export interface DoclingSection {
  number: number;        // 1-based
  title: string;
  startPage: number;
  endPage: number;
  text: string;          // Markdown paragraphs of this section
  kind: ChapterKind;
}

export interface DoclingExtraction {
  markdown: string;
  pageCount: number;
  sections: DoclingSection[];
  // Metadaten aus Docling, null bei gescannten PDFs
  metadata: {
    title: string | null;
    author: string | null;
  };
  // Docling-JSON roh, für Ablage und spätere Auswertung
  docJson: unknown | null;
}

export interface DoclingTextItem {
  label?: string;
  text?: string;
  level?: number;
  prov?: Array<{ page_no?: number }>;
}

export interface DoclingDocumentJson {
  pages?: Record<string, unknown>;
  texts?: DoclingTextItem[];
  // PDF-Metadaten, Titel mal in title, mal in subject
  meta?: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    [key: string]: unknown;
  };
}


export interface DoclingResponse {
  document?: {
    md_content?: string;
    json_content?: DoclingDocumentJson;
  };
  status?: string;
  errors?: Array<{ error_message?: string }>;
}

export interface AsyncTaskHandle {
  task_id: string;
}

export interface PollResponse {
  task_status?: string;
  task_progress?: number;
  task_meta?: Record<string, unknown>;
  // Weitere Felder je nach Version, z. B. processed_pages
  [key: string]: unknown;
}
