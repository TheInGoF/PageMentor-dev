// API: Engine-Status, Selbsttest, Reparaturen
import { request } from "./request";

export type CheckStatus = "ok" | "warn" | "error" | "skipped";

export interface EngineCheck {
  id: string;
  title: string;
  status: CheckStatus;
  message: string;
  repair?: string;
  help?: string;
  durationMs?: number;
}

export interface EngineStatus {
  windows: boolean;
  results: EngineCheck[];
  checkedAt: number;
  checking: boolean;
  task: { repair: string; title: string; message: string; fraction?: number; startedAt: number } | null;
  lastError: string | null;
  autoStart: "aus" | "läuft" | "fertig" | "braucht-hilfe";
}

export const engineApi = {
  engine: {
    status: () => request<EngineStatus>("/api/engine/status"),
    selftest: () => request<{ results: EngineCheck[] }>("/api/engine/selftest", { method: "POST" }),
    repair: (id: string) => request<{ started: boolean }>(`/api/engine/repair/${id}`, { method: "POST" }),
  },
};
