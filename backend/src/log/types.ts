// Gemeinsame Typen fürs Logging

export type LogLevel = "debug" | "info" | "warn" | "error";

// Kontext, der an jeder Zeile hängt
export interface LogContext {
  jobId?: string;
  docId?: string;
  chapterId?: string;
  reqId?: string;
  engine?: string;
  durationMs?: number;
  [key: string]: unknown;
}

// Fehler in serialisierbarer Form
export interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
  status?: number;
  url?: string;
  body?: string;
  cause?: ErrorInfo;
}

export const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
