// Datentypen der API, Teil 2
import type { DocType } from "./types";

export interface SearchHitDocument {
  id: string;
  title: string;
  filename: string;
  type: string;
  tags: string[];
  language: string;
  page_count: number;
  snippet: string | null;
}

export interface SearchHitChapter {
  id: string;
  document_id: string;
  document_title: string;
  number: number;
  title: string;
  snippet: string | null;
}

export interface SearchResult {
  documents: SearchHitDocument[];
  chapters: SearchHitChapter[];
  enabled: boolean;
}

export interface DashboardDaily {
  date: string;
  count: number;
  avgQuality: number;
}

export interface DashboardWeakTopic {
  chapter_id: string;
  chapter_title: string;
  chapter_number: number;
  document_id: string;
  document_title: string;
  low_quality_count: number;
  avg_ease: number;
}

export interface DashboardRecent {
  id: string;
  title: string;
  type: string;
  page_count: number;
  ocr_status: string;
  created_at: string;
}

export interface Module {
  id: string;
  name: string;
  semester: string | null;
  description: string | null;
  color: string;
  icon: string;
  sort_order: number;
  // 0 | 1: abgeschlossene Module zugeklappt und unten
  completed: number;
  created_at: string;
  // Aus der Prüfungsordnung
  code?: string | null;
  cp?: number | null;
  study_semester?: number | null;
  exam_form?: string | null;
  area?: string | null;
  in_path?: number;
}

export interface ModuleListItem extends Module {
  doc_count: number;
  script_count: number;
  exam_doc_count: number;
  exercise_doc_count: number;
  card_count: number;
  card_due: number;
  audio_done: number;
  exam_count: number;
  exam_avg_score: number | null;
}

export interface ModuleDocument {
  id: string;
  title: string;
  filename: string;
  type: DocType;
  language: string;
  page_count: number;
  ocr_status: string;
  short_code?: string | null;
  series_sequence?: string | null;
  created_at: string;
  chapter_count: number;
  audio_done: number;
  card_count: number;
}

export interface ModuleAudioChapter {
  id: string;
  duration_ms: number;
  voice: string;
  status: string;
  chapter_title: string;
  chapter_number: number;
  sort_order: number;
  document_id: string;
  document_title: string;
  document_type: DocType;
}

export interface ModuleSummary {
  id: string;
  chapter_id: string;
  level: SummaryLevel;
  content: string;
  model: string;
  generation_ms?: number;
  created_at: string;
  chapter_title: string;
  chapter_number: number;
  document_id: string;
  document_title: string;
}

export interface ModuleExam {
  id: string;
  title: string;
  score: number | null;
  total: number;
  taken_ms: number | null;
  status: "open" | "closed";
  created_at: string;
  finished_at: string | null;
  document_title: string;
}

export interface ModuleDetail {
  module: Module;
  documents: ModuleDocument[];
  cardStats: { total: number; due: number; learned: number };
  exams: ModuleExam[];
  audioChapters: ModuleAudioChapter[];
  summaries: ModuleSummary[];
}

export interface DashboardData {
  totals: {
    documents: number;
    cards: number;
    due: number;
    learned: number;
    audio_done: number;
    exams: number;
    exam_avg_score: number;
  };
  streak: number;
  activity: DashboardDaily[];
  weakTopics: DashboardWeakTopic[];
  recent: DashboardRecent[];
}


export type SummaryLevel = "bullets" | "paragraph" | "detailed";

export interface Summary {
  id: string;
  chapter_id: string;
  level: SummaryLevel;
  content: string;
  model: string;
  generation_ms?: number;
  created_at: string;
  chapter_number?: number;
  chapter_title?: string;
}

export interface OllamaStatus {
  available: boolean;
  url: string;
  defaultModel: string;
  models: string[];
  // Anbieter-Kette: Ollama PC → Mac → Claude → keiner
  providerType?: "ollama" | "anthropic" | null;
  label?: string;
  candidates?: Array<{ label: string; type: string; url: string }>;
}

export type ProgressPhase =
  | "pipeline.start"
  | "pipeline.extract"
  | "pipeline.extraction"
  | "pipeline.chapters"
  | "pipeline.done"
  | "pipeline.failed"
  | "audiobook.start"
  | "audiobook.chapter.preprocess"
  | "audiobook.chapter.start"
  | "audiobook.chapter.progress"
  | "audiobook.chapter.done"
  | "audiobook.chapter.failed"
  | "audiobook.book.building"
  | "audiobook.m4b.start"
  | "audiobook.m4b.progress"
  | "audiobook.m4b.done"
  | "audiobook.done"
  | "audiobook.failed"
  | "audiobook.canceled"
  | "cards.start"
  | "cards.chapter"
  | "cards.chunk"
  | "cards.progress"
  | "cards.done"
  | "cards.failed"
  | "cards.canceled";

export interface ProgressEvent {
  phase: ProgressPhase;
  docId: string;
  chapterId?: string;
  chapterNumber?: number;
  total?: number;
  current?: number;
  message?: string;
  ts: number;
}

export interface TutorSession {
  id: string;
  title: string | null;
  module_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TutorMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  // user: Text; assistant: TutorAnswer als JSON
  content: string;
  created_at: string;
}

export interface TutorSource {
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
}

export interface TutorAnswer {
  shortAnswer: string;
  reasoning: string;
  sources: TutorSource[];
  model: string;
}
