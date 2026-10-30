// API: Gemma-Anweisungen bearbeiten und zurücksetzen
import { request } from "./request";

export interface PromptInfo {
  id: string;
  text: string;
  original: string;
  custom: boolean;
  originalChanged: boolean;
}

export const promptsApi = {
  prompts: {
    list: () => request<{ prompts: PromptInfo[] }>("/api/prompts"),
    save: (id: string, text: string) =>
      request<PromptInfo>(`/api/prompts/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }),
    reset: (id: string) => request<PromptInfo>(`/api/prompts/${id}`, { method: "DELETE" }),
  },
};

export interface PronunciationEntry {
  from: string;
  to: string;
}
type PronunciationRes = { entries: PronunciationEntry[]; custom: boolean; defaults: PronunciationEntry[] };

export const pronunciationApi = {
  pronunciation: {
    get: () => request<PronunciationRes>("/api/pronunciation"),
    save: (entries: PronunciationEntry[]) =>
      request<PronunciationRes>("/api/pronunciation", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries }) }),
    reset: () => request<PronunciationRes>("/api/pronunciation", { method: "DELETE" }),
  },
};
