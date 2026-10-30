// API: Hörbuch-Lauf für mehrere Bücher
import { request } from "./request";

export type BatchStep = "wait" | "docling" | "audio" | "abs" | "done" | "failed" | "canceled";

export interface AudiobookBatch {
  id: string;
  status: "running" | "paused" | "done" | "canceled";
  voiceId: string;
  rate: string;
  abs: boolean;
  items: Array<{ docId: string; title: string; step: BatchStep; error?: string; note?: string }>;
  startedAt: number;
  finishedAt?: number;
  current?: { docId: string; chapter: number; chapters: number; chunk: number; chunks: number };
}

type Res = { batch: AudiobookBatch | null; absReady?: boolean };
const post = (path: string, body?: unknown) =>
  request<Res>(`/api/batch/audiobooks${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

export const batchApi = {
  batch: {
    status: () => request<Res>("/api/batch/audiobooks"),
    start: (body: { docIds: string[]; voiceId: string; rate: string; model?: string; abs: boolean }) => post("", body),
    resume: () => post("/resume"),
    cancel: () => post("/cancel"),
    dismiss: () => post("/dismiss"),
    reprocess: (docIds: string[]) => request<{ queued: number }>("/api/batch/reprocess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docIds }) }),
  },
};
