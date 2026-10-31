// API: Hörbuch und Kapitel-Audio
import { request } from "./request";
import type {
  Voice,
  AudioDocument,
  PreprocessedChapter,
  PreprocessedIntro,
  ChapterStatusResponse,
} from "./types";

export interface CompareItem {
  engine: string;
  voiceId: string;
  voiceLabel: string;
  status: "wartet" | "läuft" | "fertig" | "fehler";
  file?: string;
  ms?: number;
  error?: string;
}

export interface CompareRun {
  id: string;
  chapterId: string;
  text: string;
  startedAt: number;
  finishedAt?: number;
  items: CompareItem[];
}

// Standardstimmen je Sprache; effective = was ohne eigene Wahl greift
export interface VoiceDefaults {
  gender: "female" | "male" | "";
  byLang: Record<string, string>;
  effective: Record<string, string>;
}

export const audioApi = {
  audio: {
    compare: (docId: string, chapterId: string, voices: string[]) =>
      request<CompareRun>(`/api/audio/compare/${docId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId, voices }),
      }),
    compareStatus: (docId: string) => request<{ run: CompareRun | null }>(`/api/audio/compare/${docId}`),
    compareFileUrl: (docId: string, engine: string, runId: string) => `/api/audio/compare/${docId}/file/${engine}?r=${runId}`,
    voiceDefaults: () => request<VoiceDefaults>("/api/audio/voice-defaults"),
    setVoiceDefaults: (body: { gender?: VoiceDefaults["gender"]; byLang?: Record<string, string> }) =>
      request<VoiceDefaults>("/api/audio/voice-defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
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
    // Fertiges Hörbuch im Explorer zeigen
    reveal: (docId: string) =>
      request<{ path: string; opened: boolean }>(`/api/audio/reveal/${docId}`, { method: "POST" }),
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
    // Pro Kapitel: LLM-Aufbereitung und TTS
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
};
