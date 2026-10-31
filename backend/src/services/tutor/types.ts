// Typen und Grenzen des Tutors

// Top-K: 12 statt 8, Fragen verweisen oft auf mehrere Modelle in verschiedenen Kapiteln
export const TOP_K = 12;
export const MAX_CHUNK_CHARS = 1200;

export interface TutorSource {
  // 1-basiert, im Antworttext als "[Quelle 1]"
  n: number;
  docId: string;
  docTitle: string;
  docShortCode: string | null;
  chapterId: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  startPage: number;
  endPage: number;
  snippet: string;
  // Katalog-Eintrag statt Heftstelle: Grep-ID zum Nachschlagen
  grepId?: string | null;
  // Über die Zusammenhänge gefunden (verwandtes Kapitel eines anderen Hefts), nicht direkt über die Suche
  related?: boolean;
  // Über das Begriffsnetz als Grundlage gefunden: Name des Begriffs
  concept?: string;
  // Bewertung des Rerankers im Verhältnis zum besten Treffer
  relevance?: "hoch" | "mittel" | "niedrig";
}

export interface TutorAnswer {
  // Drei Abschnitte, freies Markdown
  shortAnswer: string;
  reasoning: string;
  // Zitierte Quellen mit Metadaten
  sources: TutorSource[];
  model: string;
  // Auslastung des Kontextfensters dieser Antwort; fehlt bei alten Antworten und anderen Anbietern
  usage?: TutorUsage;
}

export interface TutorUsage {
  promptTokens: number;
  outputTokens: number;
  ctx: number;
  // Runden im Gesprächsgedächtnis; compacted: in dieser Runde verdichtet
  memoryTurns: number;
  compacted: boolean;
}

export interface ChatSessionRow {
  id: string;
  title: string | null;
  module_id: string | null;
  created_at: string;
  updated_at: string;
  memory?: string | null;
  memory_upto?: string | null;
  memory_turns?: number;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}
