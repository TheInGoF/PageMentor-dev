// Datentypen der API, Teil 1
export type DocType = "studienheft" | "script" | "klausur" | "uebung" | "sonstiges";

export interface Document {
  id: string;
  title: string;
  filename: string;
  stored_path: string;
  mime_type: string;
  size_bytes: number;
  page_count: number;
  ocr_status: "awaiting-extraction" | "pending" | "running" | "done" | "failed";
  extraction_started_at?: number | null;
  language: string;
  type: DocType;
  created_at: string;
  tags: string[];
  module_id?: string | null;
  thumb_page?: number;
  // Titel aus PDF-Metadaten, null ohne Metadaten: dann gilt title
  doc_title?: string | null;
  // Autor aus PDF-Metadaten, für ID3 und M4B
  author?: string | null;
  // Kürzel wie "SE12k", für Dateiname und grouping-Tag
  short_code?: string | null;
  // Position in der Modul-Serie, für Sortierung und M4B-Track
  series_sequence?: string | null;
  chapter_count?: number;
  card_count?: number;
  audio_done?: number;
  audio_total?: number;
  summary_count?: number;
}

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

export interface Chapter {
  id: string;
  document_id: string;
  number: number;
  title: string;
  start_page: number;
  end_page: number;
  text: string;
  sort_order: number;
  has_audio?: number;
  kind?: ChapterKind;
}

export type TtsEngine = "qwen";

export interface Voice {
  id: string;
  label: string;
  language: string;
  locale: string;
  gender: "female" | "male";
  engine: TtsEngine;
  flagship?: boolean;
  note?: string;
  // Mittlere ms pro Zeichen, null = noch nie erfolgreich
  msPerChar?: number | null;
  // Im Hörbuch-Dropdown sichtbar
  showInAudiobook?: boolean;
}

export interface CustomVoiceMeta {
  id: string;
  label: string;
  gender: "female" | "male";
  language: string;
  refText?: string | null;
  refTextPresent: boolean;
  // Sprechstil, leer = kein Hinweis
  instruct?: string | null;
  bytes: number;
  seed: number;
  createdAt: string;
  showInAudiobook?: boolean;
}

export interface VoiceDesignMeta {
  id: string;
  label: string;
  gender: "female" | "male";
  language: string;
  description: string;
  seed: number;
  createdAt: string;
  msPerChar?: number | null;
  samplesCount?: number;
  showInAudiobook?: boolean;
}

export interface PresetVisibility {
  voice: Voice;
  visible: boolean;
}

export interface AudioTrack {
  id: string;
  chapter_id: string;
  stored_path: string;
  duration_ms: number;
  engine: string;
  voice: string;
  status: "pending" | "running" | "done" | "failed";
  chapter_title: string;
  chapter_number: number;
}

export interface AudioDocument {
  audio: AudioTrack[];
  book: { url: string } | null;
  generating: boolean;
}

export interface ChapterAudioStatus {
  chapter_id: string;
  number: number;
  title: string;
  kind: string;
  start_page: number;
  end_page: number;
  sort_order: number;
  // 1 = rein, 0 = raus, null = Standard der Kapitelart
  include_in_audio: number | null;
  text_length: number;
  audio_text_length: number | null;
  audio_text_model: string | null;
  audio_id: string | null;
  duration_ms: number | null;
  voice: string | null;
  audio_status: "pending" | "running" | "done" | "failed" | null;
}

export interface PreprocessedChapter {
  chapterId: string;
  originalText: string;
  audioText: string | null;
  model: string | null;
  cleaned: boolean;
}

export interface PreprocessedIntro {
  docId: string;
  originalText: string;
  audioText: string | null;
  model: string | null;
  cleaned: boolean;
}

export interface AudiobookIntro {
  text: string | null;
  audioUrl: string | null;
  docMeta: {
    title: string;
    author: string | null;
    language: string;
  } | null;
}

export interface ChapterStatusResponse {
  chapters: ChapterAudioStatus[];
  intro: AudiobookIntro;
}

export interface Card {
  id: string;
  document_id: string;
  chapter_id: string | null;
  question: string;
  answer: string;
  hint: string | null;
  difficulty: "easy" | "medium" | "hard";
  source_page: number | null;
  source: "extracted" | "manual" | "ai_generated" | "ai_filled";
  created_at: string;
  chapter_title?: string;
  chapter_number?: number;
  ease?: number;
  reps?: number;
  streak?: number;
  next_review?: string | null;
  last_seen?: string | null;
}

export interface CardStats {
  total: number;
  due: number;
  learned: number;
}

export type ReviewQuality = 1 | 3 | 5;

export interface ExamSessionSummary {
  id: string;
  title: string;
  score: number | null;
  total: number;
  planned_duration_ms: number | null;
  taken_ms: number | null;
  status: "open" | "closed";
  created_at: string;
  finished_at: string | null;
}

export interface ExamCard {
  id: string;
  question: string;
  answer: string;
  chapter_id: string | null;
  chapter_title?: string | null;
  chapter_number?: number | null;
}

export interface ExamSession extends ExamSessionSummary {
  document_id: string;
  card_ids: string[];
  answers: Record<string, { text?: string; quality?: 1 | 3 | 5 }>;
  cards: ExamCard[];
}

export * from "./typesApp";
