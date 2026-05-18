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
  /** Real doc title from Docling metadata (PDF metadata field). May
   *  be null when the PDF has no metadata — the UI then keeps using
   *  `title` (filename-derived). */
  doc_title?: string | null;
  /** Author from Docling metadata. Used in ID3 tags + M4B header. */
  author?: string | null;
  /** User shortcode (e.g. course-booklet code "SE12k" or volume
   *  number "1", "2", …). Feeds into the M4B download filename and
   *  the metadata (iTunes `grouping` field). */
  short_code?: string | null;
  /** Position in der Modul-Serie (z.B. "1" fuer das erste Heft).
   *  Wird als ABS-series.sequence + M4B-track-Atom geschrieben und
   *  steuert die Sortierung in der Modul-Detail-Ansicht. */
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
  /** Rolling average of synthesis duration in ms per character.
   *  Updated by the backend via EMA after each successful chunk.
   *  Null means: never synthesized successfully. */
  msPerChar?: number | null;
  /** True iff this voice is currently selected to appear in the
   *  audiobook tab's voice picker. Settings can flip this per voice. */
  showInAudiobook?: boolean;
}

export interface CustomVoiceMeta {
  id: string;
  label: string;
  gender: "female" | "male";
  language: string;
  refText?: string | null;
  refTextPresent: boolean;
  /** Optional speaking-style prompt (passed to generate_voice_clone
   *  as `instruct`). Empty/null = no style hint. */
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
  /** 1 = include, 0 = exclude, null = use kind-default */
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

// RagSource interface removed — per-document Q&A was replaced by the
// module-scoped Tutor whose source shape (TutorSource) is defined
// further below alongside the tutor API client.

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
  health: () =>
    request<{ status: string; version: string }>("/api/health"),
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
        author?: string | null;
        short_code?: string | null;
        series_sequence?: string | null;
      }
    ) =>
      request<Document>(`/api/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    reprocess: (id: string, opts?: { forceOcr?: boolean }) => {
      // Optional ?force_ocr= persists the flag on the document before
      // re-running extraction. Caller doesn't have to manage state.
      const qs =
        opts?.forceOcr === undefined
          ? ""
          : `?force_ocr=${opts.forceOcr ? "true" : "false"}`;
      return request<{ status: string }>(
        `/api/documents/${id}/reprocess${qs}`,
        { method: "POST" }
      );
    },
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
    /** Sequential, chunked, Gemma-driven card build over every chapter
     *  of the document. Returns immediately; progress streams over the
     *  per-document SSE channel (phases cards.start, cards.chapter,
     *  cards.chunk, cards.progress, cards.done / failed / canceled). */
    /** Start (or resume) the build. With rebuild=true wipes existing
     *  ai_generated cards first; otherwise resumes by skipping chapters
     *  that already have cards from a previous run. With model=… the
     *  caller pins a specific Ollama model (overrides server-side
     *  Settings → Default Ollama Model). */
    build: (docId: string, opts?: { rebuild?: boolean; model?: string }) => {
      const params = new URLSearchParams();
      if (opts?.rebuild) params.set("rebuild", "true");
      if (opts?.model && opts.model.trim()) params.set("model", opts.model.trim());
      const qs = params.toString();
      return request<{ status: string; rebuild?: boolean; model?: string | null }>(
        `/api/cards/build/${docId}${qs ? "?" + qs : ""}`,
        { method: "POST" }
      );
    },
    buildStatus: (docId: string) =>
      request<{ active: boolean }>(`/api/cards/build/${docId}`),
    buildCancel: (docId: string) =>
      request<{ canceled: boolean }>(`/api/cards/build/${docId}`, { method: "DELETE" }),
    deleteAll: (docId: string) =>
      request<{ deleted: number }>(`/api/cards/all/${docId}`, {
        method: "DELETE",
      }),
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
          qwenTtsUrl?: string;
          qwenTtsApiKeyPresent?: boolean;
          qwenTtsInstruction?: string;
          qwenTtsTemperature?: string;
          qwenTtsTopP?: string;
          qwenTtsTopK?: string;
          qwenTtsRepetitionPenalty?: string;
          ttsMaxChunk?: string;
          absUrl?: string;
          absApiKeyPresent?: boolean;
          absLibraryId?: string;
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
      qwenTtsUrl?: string;
      qwenTtsApiKey?: string;
      qwenTtsInstruction?: string;
      qwenTtsTemperature?: string;
      qwenTtsTopP?: string;
      qwenTtsTopK?: string;
      qwenTtsRepetitionPenalty?: string;
      ttsMaxChunk?: string;
      absUrl?: string;
      absApiKey?: string;
      absLibraryId?: string;
    }) =>
      request<{ config: unknown; status: OllamaStatus }>("/api/llm/config", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    removeKey: (
      provider: "anthropic" | "openai" | "google" | "qwenTts" | "abs"
    ) =>
      request<{ config: unknown }>(`/api/llm/config/${provider}`, { method: "DELETE" }),
  },
  admin: {
    /** Hard reset of the GPU swap: the arbiter stops the TTS
     *  container and unloads all Ollama models. Use when the swap
     *  hangs. */
    gpuReset: () =>
      request<{ ok: true; result: Record<string, unknown> }>(
        "/api/admin/gpu/reset",
        { method: "POST" }
      ),
  },
  abs: {
    /** Pings the ABS server, verifies the token. */
    test: () =>
      request<{
        ok: boolean;
        url?: string;
        username?: string;
        serverVersion?: string;
        message?: string;
      }>("/api/admin/abs/test"),
    /** Lists all libraries (for the Settings dropdown). */
    libraries: () =>
      request<{
        libraries: Array<{ id: string; name: string; mediaType: string }>;
      }>("/api/admin/abs/libraries"),
    /** Uploads an already-built M4B to the configured library. */
    upload: (docId: string) =>
      request<{
        ok: true;
        libraryItemId?: string;
        uploadedBytes: number;
        url?: string;
      }>(`/api/admin/abs/upload/${docId}`, { method: "POST" }),
  },
  customVoices: {
    list: () =>
      request<{ voices: CustomVoiceMeta[] }>("/api/voices/custom"),
    upload: (input: {
      label: string;
      gender: "female" | "male";
      language?: string;
      refText?: string;
      file: File;
    }) => {
      const form = new FormData();
      form.append("label", input.label);
      form.append("gender", input.gender);
      if (input.language) form.append("language", input.language);
      if (input.refText) form.append("refText", input.refText);
      form.append("file", input.file, input.file.name);
      return request<{ voice: CustomVoiceMeta }>("/api/voices/custom", {
        method: "POST",
        body: form,
      });
    },
    remove: (id: string) =>
      request<{ ok: true }>(`/api/voices/custom/${id}`, { method: "DELETE" }),
    previewUrl: (id: string, text?: string) =>
      `/api/voices/custom/${id}/preview${text ? `?text=${encodeURIComponent(text)}` : ""}`,
    setVisibility: (id: string, showInAudiobook: boolean) =>
      request<{ ok: true; showInAudiobook: boolean }>(
        `/api/voices/custom/${id}/visibility`,
        {
          method: "PATCH",
          body: JSON.stringify({ showInAudiobook }),
        }
      ),
    /** Patch label/gender/language/refText/instruct on an existing
     *  custom voice. Audio file + seed are immutable (would change
     *  the voice identity). */
    update: (
      id: string,
      patch: {
        label?: string;
        gender?: "female" | "male";
        language?: string;
        refText?: string | null;
        instruct?: string | null;
      }
    ) =>
      request<{ ok: true; sample: CustomVoiceMeta }>(
        `/api/voices/custom/${id}`,
        { method: "PATCH", body: JSON.stringify(patch) }
      ),
  },
  voiceDesigns: {
    list: () => request<{ voices: VoiceDesignMeta[] }>("/api/voices/design"),
    /** Creates a design voice. `refBlob` is optional but strongly
     *  recommended: it contains the audio from the preview wizard.
     *  Backend stores it as the reference and uses it for all
     *  future synthesis calls (via base clone) — so the voice in
     *  the audiobook sounds EXACTLY like what the user approved in
     *  the preview. Without a blob, the server generates its own
     *  reference, which may diverge from the preview due to Qwen's
     *  non-determinism. */
    create: (input: {
      label: string;
      gender: "female" | "male";
      language?: string;
      description: string;
      seed?: number;
      refBlob?: Blob;
      refText?: string;
    }) => {
      const form = new FormData();
      form.append("label", input.label);
      form.append("gender", input.gender);
      if (input.language) form.append("language", input.language);
      form.append("description", input.description);
      if (input.seed !== undefined) form.append("seed", String(input.seed));
      if (input.refBlob) form.append("ref_blob", input.refBlob, "preview.mp3");
      if (input.refText) form.append("ref_text", input.refText);
      return request<{ voice: VoiceDesignMeta }>("/api/voices/design", {
        method: "POST",
        body: form,
      });
    },
    remove: (id: string) =>
      request<{ ok: true }>(`/api/voices/design/${id}`, { method: "DELETE" }),
    /** Regenerate the reference audio of an existing voice with the
     *  current default ref-text (lengthened to ~10 s in v1.18.087 to
     *  stabilise long-form generations). The voice keeps its seed,
     *  description and gender — only the underlying speaker sample
     *  is refreshed. Triggers a Sidecar VoiceDesign call. */
    regenerateReference: (id: string) =>
      request<{ ok: true; hasReference: boolean; refTextLength: number }>(
        `/api/voices/design/${id}/regenerate-reference`,
        { method: "POST" }
      ),
    setVisibility: (id: string, showInAudiobook: boolean) =>
      request<{ ok: true; showInAudiobook: boolean }>(
        `/api/voices/design/${id}/visibility`,
        {
          method: "PATCH",
          body: JSON.stringify({ showInAudiobook }),
        }
      ),
    /** Patch label/gender/language/description on an existing design.
     *  Seed and ref audio are immutable; description IS editable
     *  (slight voice drift acceptable for refining wording). */
    update: (
      id: string,
      patch: {
        label?: string;
        gender?: "female" | "male";
        language?: string;
        description?: string;
      }
    ) =>
      request<{ ok: true; design: VoiceDesignMeta }>(
        `/api/voices/design/${id}`,
        { method: "PATCH", body: JSON.stringify(patch) }
      ),
    listPresetVisibility: () =>
      request<{ presets: PresetVisibility[] }>(
        "/api/voices/presets/visibility"
      ),
    setPresetVisibility: (visible: string[]) =>
      request<{ ok: true; visible: string[]; hidden: string[] }>(
        "/api/voices/presets/visibility",
        {
          method: "PUT",
          body: JSON.stringify({ visible }),
        }
      ),
    previewUrl: (id: string, text?: string) =>
      `/api/voices/design/${id}/preview${text ? `?text=${encodeURIComponent(text)}` : ""}`,
    /** Unsaved preview: rolls a seed (or uses the supplied one) and
     *  returns MP3 + seed via the X-Voice-Seed header. Returns the
     *  pair so the caller can trigger a save with the rolled seed. */
    previewUnsaved: async (input: {
      description: string;
      gender: "female" | "male";
      language: "de" | "en";
      seed?: number;
      text?: string;
    }): Promise<{ blob: Blob; seed: number }> => {
      const res = await fetch("/api/voices/design/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText);
        throw new Error(`Preview ${res.status}: ${t.slice(0, 200)}`);
      }
      const seedHeader = res.headers.get("X-Voice-Seed");
      const seed = seedHeader ? parseInt(seedHeader, 10) : 0;
      const blob = await res.blob();
      return { blob, seed };
    },
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
    voices: (showHidden: boolean = false) =>
      request<{ voices: Voice[] }>(
        "/api/audio/voices" + (showHidden ? "?showHidden=1" : "")
      ),
    previewUrl: (
      voiceId: string,
      opts?: {
        text?: string;
        instruct?: string;
        temperature?: string;
        topP?: string;
        topK?: string;
        repetitionPenalty?: string;
      }
    ) => {
      const parts = [`voice=${encodeURIComponent(voiceId)}`];
      if (opts?.text != null) parts.push(`text=${encodeURIComponent(opts.text)}`);
      if (opts?.instruct != null)
        parts.push(`instruct=${encodeURIComponent(opts.instruct)}`);
      if (opts?.temperature)
        parts.push(`temperature=${encodeURIComponent(opts.temperature)}`);
      if (opts?.topP) parts.push(`top_p=${encodeURIComponent(opts.topP)}`);
      if (opts?.topK) parts.push(`top_k=${encodeURIComponent(opts.topK)}`);
      if (opts?.repetitionPenalty)
        parts.push(`repetition_penalty=${encodeURIComponent(opts.repetitionPenalty)}`);
      return `/api/audio/preview?${parts.join("&")}`;
    },
    get: (docId: string) => request<AudioDocument>(`/api/audio/document/${docId}`),
    generate: (docId: string, voice: string, rate: string, model?: string) =>
      request<{ status: string; voice: string }>(`/api/audio/generate/${docId}`, {
        method: "POST",
        body: JSON.stringify({ voice, rate, model }),
      }),
    clear: (docId: string) =>
      request<{ status: string }>(`/api/audio/document/${docId}`, { method: "DELETE" }),
    clearChapter: (audioId: string) =>
      request<{ status: string }>(`/api/audio/chapter/${audioId}`, { method: "DELETE" }),
    cancel: (docId: string) =>
      request<{ status: string }>(`/api/audio/cancel/${docId}`, { method: "POST" }),
    progress: (docId: string) =>
      request<
        | { running: false }
        | {
            running: true;
            startedAt: number;
            totalChapters: number;
            currentChapter: number;
            chunkCurrent: number;
            chunkTotal: number;
            chapterChars: number[];
          }
      >(`/api/audio/progress/${docId}`),
    rebuildM4B: (docId: string) =>
      request<{ ok: true; chapters: number }>(`/api/audio/rebuild-m4b/${docId}`, {
        method: "POST",
      }),
    fileUrl: (audioId: string) => `/api/audio/file/${audioId}`,
    bookUrl: (docId: string) => `/api/audio/book/${docId}`,
    streamUrl: (docId: string) => `/api/audio/stream/${docId}`,
    // Per-Chapter workflow (manual Ollama-clean + per-chapter TTS).
    chapterStatus: (docId: string) =>
      request<ChapterStatusResponse>(
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
    generateChapter: (
      chapterId: string,
      voice: string,
      rate: string,
      model?: string
    ) =>
      request<{ status: string; chapterId: string; voice: string }>(
        `/api/audio/generate-chapter/${chapterId}`,
        { method: "POST", body: JSON.stringify({ voice, rate, model }) }
      ),
    setInclude: (chapterId: string, include: boolean | null) =>
      request<{ chapterId: string; include: boolean | null }>(
        `/api/audio/chapter-include/${chapterId}`,
        { method: "PATCH", body: JSON.stringify({ include }) }
      ),
    setIncludeByKind: (docId: string, kind: string, include: boolean | null) =>
      request<{ kind: string; include: boolean | null; updated: number }>(
        `/api/audio/include-by-kind/${docId}`,
        { method: "PATCH", body: JSON.stringify({ kind, include }) }
      ),
    setIntroText: (docId: string, text: string | null) =>
      request<{ docId: string; text: string | null }>(
        `/api/audio/intro/${docId}`,
        { method: "PUT", body: JSON.stringify({ text }) }
      ),
    generateIntro: (
      docId: string,
      voice: string,
      rate: string,
      model?: string
    ) =>
      request<{ status: string; docId: string; voice: string }>(
        `/api/audio/intro/${docId}/generate`,
        { method: "POST", body: JSON.stringify({ voice, rate, model }) }
      ),
    deleteIntroAudio: (docId: string) =>
      request<{ status: string }>(
        `/api/audio/intro/${docId}/file`,
        { method: "DELETE" }
      ),
    introUrl: (docId: string) => `/api/audio/intro/${docId}/file`,
    preprocessIntro: (
      docId: string,
      body?: { model?: string; force?: boolean }
    ) =>
      request<{
        docId: string;
        text: string;
        model: string;
        cached: boolean;
      }>(`/api/audio/intro/${docId}/preprocess`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      }),
    getPreprocessedIntro: (docId: string) =>
      request<PreprocessedIntro>(`/api/audio/intro/${docId}/preprocessed`),
    savePreprocessedIntro: (docId: string, text: string | null) =>
      request<{ docId: string; saved?: boolean; cleared?: boolean; length?: number }>(
        `/api/audio/intro/${docId}/preprocessed`,
        { method: "PATCH", body: JSON.stringify({ text }) }
      ),
  },
  rag: {
    // Per-document Q&A removed in favor of the module-scoped Tutor chat.
    // What remains here is just the embed-server status + the reembed
    // trigger, both consumed by the Settings page.
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
  tutor: {
    listSessions: () =>
      request<{ sessions: TutorSession[] }>("/api/tutor/sessions"),
    createSession: (moduleId: string | null) =>
      request<{ session: TutorSession }>("/api/tutor/sessions", {
        method: "POST",
        body: JSON.stringify({ moduleId }),
      }),
    getSession: (id: string) =>
      request<{ session: TutorSession; messages: TutorMessage[] }>(
        `/api/tutor/sessions/${id}`
      ),
    rename: (id: string, title: string) =>
      request<{ status: string }>(`/api/tutor/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),
    remove: (id: string) =>
      request<{ status: string }>(`/api/tutor/sessions/${id}`, {
        method: "DELETE",
      }),
    ask: (sessionId: string, question: string) =>
      request<{ answer: TutorAnswer }>(
        `/api/tutor/sessions/${sessionId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ question }),
        }
      ),
  },
};

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
  /** For role=user: raw text. For role=assistant: JSON-stringified
   *  TutorAnswer — parse before rendering. */
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
