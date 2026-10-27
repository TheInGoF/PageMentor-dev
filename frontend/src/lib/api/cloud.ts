// API: Cloud-Hilfe (nur mit Zustimmung vor jedem Versand)
import { request } from "./request";

export type CloudTask = "lektorat" | "rezepte" | "zweite_meinung" | "diagnose";

export interface CloudStatus {
  enabled: boolean;
  targets: Array<{ provider: "anthropic" | "openai"; model: string; label: string }>;
  log: Array<{ task: string; provider: string; model: string; chars: number; ok: number; sent_at: string }>;
}

export interface CloudPreview {
  id: string;
  task: CloudTask;
  title: string;
  provider: string;
  model: string;
  system: string;
  text: string;
  chars: number;
}

export interface CloudResult {
  task: CloudTask;
  ref: string | null;
  answer: string;
  applied?: number;
  parsed?: { korrigiert_md?: string; hinweise?: string[]; sicher?: boolean } | null;
  error?: string;
}

const post = <T,>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const cloudApi = {
  cloud: {
    status: () => request<CloudStatus>("/api/cloud/status"),
    setEnabled: (enabled: boolean) => post<{ enabled: boolean }>("/api/cloud/enabled", { enabled }),
    failures: () => request<{ failures: Array<{ id: number; kind: string; model: string | null; error: string | null; created_at: string; inputChars: number }> }>("/api/cloud/failures"),
    preview: (task: CloudTask, params: Record<string, unknown>, provider?: string) => post<CloudPreview>("/api/cloud/preview", { task, params, provider }),
    send: (id: string) => post<CloudResult>(`/api/cloud/send/${id}`),
    applyLektorat: (itemId: string, body_md: string) => post<{ updated: boolean }>(`/api/cloud/lektorat/${encodeURIComponent(itemId)}/apply`, { body_md }),
  },
};
