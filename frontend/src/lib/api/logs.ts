// API: Logs aus Dateien, Diagnosepaket
import { request } from "./request";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StoredLogLine {
  time: string;
  level: LogLevel;
  src: string;
  area?: string;
  msg: string;
  ctx?: Record<string, unknown>;
  err?: LogErrorInfo;
}

export interface LogErrorInfo {
  name: string;
  message: string;
  stack?: string;
  status?: number;
  url?: string;
  body?: string;
  cause?: LogErrorInfo;
}

export interface LogQueryParams {
  day: string;
  level?: LogLevel;
  area?: string;
  docId?: string;
  jobId?: string;
  q?: string;
}

export const logsApi = {
  logs: {
    days: () => request<{ days: Array<{ day: string; size: number }>; today: string }>("/api/logs/days"),
    query: (p: LogQueryParams) => {
      const qs = new URLSearchParams(
        Object.entries(p).filter(([, v]) => v) as Array<[string, string]>
      );
      return request<{ lines: StoredLogLine[]; total: number }>(`/api/logs?${qs}`);
    },
    createDiagnostics: () =>
      request<{ name: string; size: number; dir: string; url: string }>("/api/logs/diagnostics", { method: "POST" }),
  },
};
