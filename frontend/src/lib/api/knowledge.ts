// API: Wissensdatenbank (Stapel-Import, Prüffragen der Suche)
import { request } from "./request";

export interface BatchStatus {
  waiting: number;
  running: number;
  done: number;
  failed: number;
  current: string | null;
  avgSeconds: number | null;
  etaSeconds: number | null;
  paused: boolean;
  nightOnly: boolean;
  failures: Array<{ id: number; path: string; error: string | null }>;
}

export interface EvalQuestion {
  id: string;
  question: string;
  module_id: string | null;
  expected_document_id: string;
  expected_page: number | null;
  doc_title: string;
}

export interface EvalReport {
  k: number;
  questions: number;
  recall: number;
  mrr: number;
  mode: string;
  results: Array<{ id: string; question: string; rank: number | null }>;
}

const post = (path: string, body?: unknown) => request<any>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const knowledgeApi = {
  knowledge: {
    batch: () => request<BatchStatus>("/api/knowledge/batch"),
    enqueue: (b: { folder: string; docType: string; moduleId: string | null; mdFolder: string | null }) =>
      post("/api/knowledge/batch", b) as Promise<{ added: number; skipped: number; withMarkdown: number }>,
    flags: (f: { paused?: boolean; nightOnly?: boolean }) => post("/api/knowledge/batch/flags", f) as Promise<BatchStatus>,
    retry: () => post("/api/knowledge/batch/retry") as Promise<{ retried: number }>,
    clear: () => post("/api/knowledge/batch/clear") as Promise<{ removed: number }>,
    evalList: () => request<{ questions: EvalQuestion[] }>("/api/knowledge/eval"),
    evalAdd: (q: { question: string; expected_document_id: string; expected_page: number | null; module_id: string | null }) => post("/api/knowledge/eval", q),
    evalDelete: (id: string) => request<{ deleted: boolean }>(`/api/knowledge/eval/${id}`, { method: "DELETE" }),
    evalRun: () => post("/api/knowledge/eval/run") as Promise<EvalReport>,
  },
};
