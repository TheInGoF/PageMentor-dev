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

export type TtsEngine = "edge" | "kokoro";

export interface Voice {
  id: string;
  label: string;
  language: string;
  locale: string;
  gender: "female" | "male";
  engine: TtsEngine;
  flagship?: boolean;
  note?: string;
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

export interface Card {
  id: string;
  document_id: string;
  chapter_id: string | null;
  question: string;
  answer: string;
  hint: string | null;
  difficulty: "easy" | "medium" | "hard";
  source_page: number | null;
  source: "extracted" | "manual" | "ai_generated";
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
  created_at: string;
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

export interface RagSource {
  id: string;
  score: number;
  document_id: string;
  document_title: string;
  chapter_id: string;
  chapter_number: number;
  chapter_title: string;
  chapter_kind: string;
  start_page: number;
  end_page: number;
  text: string;
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
  // v1.03+: multi-provider chain (Ollama-PC → Mac → Claude → none)
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
  | "audiobook.done"
  | "audiobook.failed"
  | "audiobook.canceled";

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

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Forward the UI locale so backend error messages match the language.
  let acceptLang = "en";
  try {
    const { currentLocale } = await import("./i18n");
    acceptLang = currentLocale();
  } catch {
    // Loading the i18n module during early bootstrap may fail silently.
  }
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Accept-Language": acceptLang,
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  auth: {
    check: () => request<{ authenticated: boolean }>("/api/auth/check"),
    login: (password: string) =>
      request<{ status: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    logout: () => request<{ status: string }>("/api/auth/logout", { method: "POST" }),
  },
  documents: {
    list: () => request<Document[]>("/api/documents"),
    get: (id: string) => request<Document>(`/api/documents/${id}`),
    upload: (form: FormData) =>
      request<{ id: string; title: string; filename: string }>(
        "/api/documents/upload",
        { method: "POST", body: form }
      ),
    remove: (id: string) =>
      request<{ status: string }>(`/api/documents/${id}`, { method: "DELETE" }),
    patch: (
      id: string,
      body: Partial<Pick<Document, "title" | "type" | "tags">> & {
        module_id?: string | null;
        thumb_page?: number;
      }
    ) =>
      request<Document>(`/api/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    reprocess: (id: string) =>
      request<{ status: string }>(`/api/documents/${id}/reprocess`, { method: "POST" }),
    cancelExtract: (id: string) =>
      request<{ status: string }>(`/api/documents/${id}/extract/cancel`, { method: "POST" }),
    doclingStatus: () =>
      request<{ alive: boolean }>("/api/documents/docling/status"),
    tags: () => request<Array<{ label: string; usage: number }>>("/api/documents/tags/all"),
  },
  chapters: {
    list: (docId: string) => request<Chapter[]>(`/api/chapters/${docId}`),
    detect: (docId: string) =>
      request<{ status: string; chapters: number }>(`/api/chapters/detect/${docId}`, {
        method: "POST",
      }),
    patch: (id: string, body: Partial<Chapter>) =>
      request<Chapter>(`/api/chapters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      request<{ status: string }>(`/api/chapters/${id}`, { method: "DELETE" }),
    merge: (chapterIds: string[]) =>
      request<{ status: string; kept: string }>(`/api/chapters/merge`, {
        method: "POST",
        body: JSON.stringify({ chapter_ids: chapterIds }),
      }),
  },
  cards: {
    list: (docId: string, chapterId?: string) =>
      request<Card[]>(
        `/api/cards/document/${docId}${chapterId ? `?chapter=${chapterId}` : ""}`
      ),
    due: (docId: string) => request<Card[]>(`/api/cards/due/${docId}`),
    stats: (docId: string) => request<CardStats>(`/api/cards/stats/${docId}`),
    extract: (docId: string, replace = false) =>
      request<{ status: string; extracted: number; chapters: number }>(
        `/api/cards/extract/${docId}`,
        { method: "POST", body: JSON.stringify({ replace }) }
      ),
    create: (body: {
      document_id: string;
      chapter_id?: string | null;
      question: string;
      answer?: string;
      hint?: string;
      difficulty?: "easy" | "medium" | "hard";
      source_page?: number;
    }) => request<{ id: string }>("/api/cards", { method: "POST", body: JSON.stringify(body) }),
    patch: (
      id: string,
      body: Partial<Pick<Card, "question" | "answer" | "hint" | "difficulty">>
    ) =>
      request<{ status: string }>(`/api/cards/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      request<{ status: string }>(`/api/cards/${id}`, { method: "DELETE" }),
    review: (id: string, quality: ReviewQuality) =>
      request<{
        status: string;
        nextReview: string;
        ease: number;
        reps: number;
        streak: number;
      }>(`/api/cards/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ quality }),
      }),
    aiGenerate: (
      chapterId: string,
      body: { count: number; difficulty: "easy" | "medium" | "hard"; style: "basic" | "deep" | "exam" }
    ) =>
      request<{ generated: number; model: string }>(
        `/api/cards/ai-generate/${chapterId}`,
        { method: "POST", body: JSON.stringify(body) }
      ),
    similar: (cardId: string) =>
      request<{ generated: number; model: string }>(
        `/api/cards/similar/${cardId}`,
        { method: "POST" }
      ),
    exportUrl: (docId: string, format: "csv" | "json" = "csv") =>
      `/api/cards/export/${docId}?format=${format}`,
    importCsv: (docId: string, file: File) => {
      const form = new FormData();
      form.set("file", file);
      return request<{ imported: number }>(`/api/cards/import/${docId}`, {
        method: "POST",
        body: form,
      });
    },
  },
  llmConfig: {
    get: () =>
      request<{
        config: {
          ollamaUrlPc?: string;
          ollamaUrlMac?: string;
          ollamaUrl?: string;
          ollamaModel?: string;
          anthropicModel?: string;
          anthropicApiKeyPresent: boolean;
          openaiModel?: string;
          openaiApiKeyPresent: boolean;
          googleModel?: string;
          googleApiKeyPresent: boolean;
        };
        status: OllamaStatus;
      }>("/api/llm/config"),
    put: (body: {
      ollamaUrlPc?: string;
      ollamaUrlMac?: string;
      ollamaUrl?: string;
      ollamaModel?: string;
      anthropicApiKey?: string;
      anthropicModel?: string;
      openaiApiKey?: string;
      openaiModel?: string;
      googleApiKey?: string;
      googleModel?: string;
    }) =>
      request<{ config: unknown; status: OllamaStatus }>("/api/llm/config", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    removeKey: (provider: "anthropic" | "openai" | "google") =>
      request<{ config: unknown }>(`/api/llm/config/${provider}`, { method: "DELETE" }),
  },
  summary: {
    status: () => request<OllamaStatus>("/api/summary/status"),
    document: (docId: string) => request<Summary[]>(`/api/summary/document/${docId}`),
    chapter: (chapterId: string) => request<Summary[]>(`/api/summary/chapter/${chapterId}`),
    generate: (chapterId: string, level: SummaryLevel, model?: string) =>
      request<{
        id: string;
        level: SummaryLevel;
        content: string;
        model: string;
        generation_ms: number;
        totalMs: number;
      }>(`/api/summary/chapter/${chapterId}`, {
        method: "POST",
        body: JSON.stringify({ level, model }),
      }),
    generateStream: async (
      chapterId: string,
      level: SummaryLevel,
      model: string | undefined,
      handlers: {
        onToken: (text: string) => void;
        onDone: (payload: {
          id: string;
          model: string;
          content: string;
          generation_ms?: number;
        }) => void;
        onError?: (message: string) => void;
      }
    ): Promise<void> => {
      const res = await fetch(`/api/summary/chapter/${chapterId}/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, model }),
      });
      if (!res.ok || !res.body) throw new Error(`Stream ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "token") handlers.onToken(ev.data);
            else if (ev.type === "done") handlers.onDone(ev);
            else if (ev.type === "error")
              handlers.onError?.(ev.message || "Unknown error");
          } catch {
            // ignore malformed line
          }
        }
      }
    },
    remove: (id: string) =>
      request<{ status: string }>(`/api/summary/${id}`, { method: "DELETE" }),
  },
  search: {
    query: (q: string, limit = 10) =>
      request<SearchResult>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    status: () => request<{ enabled: boolean }>("/api/search/status"),
  },
  exam: {
    start: (
      docId: string,
      body: { count: number; durationMs?: number; chapterId?: string; title?: string }
    ) =>
      request<{ id: string; cardIds: string[]; total: number }>(`/api/exam/start/${docId}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    get: (sessionId: string) => request<ExamSession>(`/api/exam/${sessionId}`),
    submit: (
      sessionId: string,
      body: {
        answers: Record<string, { text?: string; quality: ReviewQuality }>;
        takenMs?: number;
      }
    ) =>
      request<{ status: string; score: number; correct: number; partial: number; total: number }>(
        `/api/exam/${sessionId}/submit`,
        { method: "POST", body: JSON.stringify(body) }
      ),
    history: (docId: string) => request<ExamSessionSummary[]>(`/api/exam/history/${docId}`),
    remove: (sessionId: string) =>
      request<{ status: string }>(`/api/exam/${sessionId}`, { method: "DELETE" }),
  },
  audio: {
    voices: () => request<{ voices: Voice[] }>("/api/audio/voices"),
    previewUrl: (voiceId: string) =>
      `/api/audio/preview?voice=${encodeURIComponent(voiceId)}`,
    get: (docId: string) => request<AudioDocument>(`/api/audio/document/${docId}`),
    generate: (docId: string, voice: string, rate: string) =>
      request<{ status: string; voice: string }>(`/api/audio/generate/${docId}`, {
        method: "POST",
        body: JSON.stringify({ voice, rate }),
      }),
    clear: (docId: string) =>
      request<{ status: string }>(`/api/audio/document/${docId}`, { method: "DELETE" }),
    clearChapter: (audioId: string) =>
      request<{ status: string }>(`/api/audio/chapter/${audioId}`, { method: "DELETE" }),
    cancel: (docId: string) =>
      request<{ status: string }>(`/api/audio/cancel/${docId}`, { method: "POST" }),
    fileUrl: (audioId: string) => `/api/audio/file/${audioId}`,
    bookUrl: (docId: string) => `/api/audio/book/${docId}`,
    streamUrl: (docId: string) => `/api/audio/stream/${docId}`,
    // Per-Chapter workflow (manual Ollama-clean + per-chapter TTS).
    chapterStatus: (docId: string) =>
      request<{ chapters: ChapterAudioStatus[] }>(
        `/api/audio/chapter-status/${docId}`
      ),
    preprocessChapter: (chapterId: string, body?: { model?: string; force?: boolean }) =>
      request<{
        chapterId: string;
        text: string;
        model: string;
        cached: boolean;
      }>(`/api/audio/preprocess/${chapterId}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      }),
    getPreprocessed: (chapterId: string) =>
      request<PreprocessedChapter>(`/api/audio/preprocessed/${chapterId}`),
    savePreprocessed: (chapterId: string, text: string | null) =>
      request<{ chapterId: string; saved?: boolean; cleared?: boolean; length?: number }>(
        `/api/audio/preprocessed/${chapterId}`,
        { method: "PATCH", body: JSON.stringify({ text }) }
      ),
    generateChapter: (chapterId: string, voice: string, rate: string) =>
      request<{ status: string; chapterId: string; voice: string }>(
        `/api/audio/generate-chapter/${chapterId}`,
        { method: "POST", body: JSON.stringify({ voice, rate }) }
      ),
  },
  feed: {
    urls: (docId: string) =>
      request<{ title: string; feedUrl: string; m4bUrl: string }>(
        `/api/feed/urls/${docId}`
      ),
  },
  rag: {
    answerStream: async (
      params: { docId: string; query: string; topK?: number; model?: string },
      handlers: {
        onSources: (sources: RagSource[]) => void;
        onToken: (text: string) => void;
        onDone: (payload: { model: string; content: string }) => void;
        onError?: (message: string) => void;
      }
    ): Promise<void> => {
      const res = await fetch("/api/rag/answer/stream", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok || !res.body) throw new Error(`Stream ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "sources") handlers.onSources(ev.sources);
            else if (ev.type === "token") handlers.onToken(ev.data);
            else if (ev.type === "done") handlers.onDone(ev);
            else if (ev.type === "error")
              handlers.onError?.(ev.message || "RAG stream error");
          } catch {
            // ignore malformed line
          }
        }
      }
    },
    status: () =>
      request<{ total: number; embedded: number; documents: number }>(
        "/api/rag/status"
      ),
    reembed: () =>
      request<{ status: string; embedded: number; failed?: number; total: number }>(
        "/api/rag/reembed",
        { method: "POST" }
      ),
  },
  dashboard: {
    get: () => request<DashboardData>("/api/dashboard"),
  },
  modules: {
    list: () => request<ModuleListItem[]>("/api/modules"),
    get: (id: string) => request<ModuleDetail>(`/api/modules/${id}`),
    create: (body: Partial<Module>) =>
      request<{ id: string }>("/api/modules", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    patch: (id: string, body: Partial<Module>) =>
      request<{ status: string }>(`/api/modules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      request<{ status: string }>(`/api/modules/${id}`, { method: "DELETE" }),
  },
};

/** Subscribe to SSE progress events. Returns an unsubscribe function. */
export function subscribeProgress(
  docId: string,
  onEvent: (ev: ProgressEvent) => void,
  onError?: (err: Event) => void
): () => void {
  const src = new EventSource(api.audio.streamUrl(docId), { withCredentials: true });
  src.addEventListener("progress", (e) => {
    try {
      onEvent(JSON.parse((e as MessageEvent).data));
    } catch {
      // ignore
    }
  });
  if (onError) src.addEventListener("error", onError);
  return () => src.close();
}
