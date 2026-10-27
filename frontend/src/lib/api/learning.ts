// API: Karten, Zusammenfassungen, Prüfungen, RAG, Tutor
import { request } from "./request";
import type {
  Card,
  CardStats,
  ReviewQuality,
  ExamSessionSummary,
  ExamSession,
  SummaryLevel,
  Summary,
  OllamaStatus,
  TutorSession,
  TutorMessage,
  TutorAnswer,
} from "./types";

export const learningApi = {
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
    // Kartenerzeugung über alle Kapitel, Fortschritt per SSE
    // rebuild: alles neu; sonst fertige Kapitel überspringen
    // model: festes Ollama-Modell
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
  rag: {
    // Nur Embedding-Status und Neu-Einbetten, für die Settings
    status: () =>
      request<{ total: number; embedded: number; documents: number; vector?: { available: boolean; error: string | null } }>(
        "/api/rag/status"
      ),
    reembed: () =>
      request<{ status: string; embedded: number; failed?: number; total: number }>(
        "/api/rag/reembed",
        { method: "POST" }
      ),
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
