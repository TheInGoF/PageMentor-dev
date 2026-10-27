// Einheitliche Log-Zeile für Live-Stream und Dateien
import type { LogErrorInfo, LogLevel, StoredLogLine } from "../../lib/api";

export interface UiLogLine {
  ts: number;
  level: LogLevel;
  source: string;
  area: string;
  message: string;
  ctx?: Record<string, unknown>;
  err?: LogErrorInfo;
}

export interface LiveLogLine {
  ts: number;
  source: string;
  level: LogLevel;
  message: string;
  area?: string;
  ctx?: Record<string, unknown>;
  err?: LogErrorInfo;
}

export function fromLive(l: LiveLogLine): UiLogLine {
  return { ts: l.ts, level: l.level, source: l.source, area: l.area ?? "-", message: l.message, ctx: l.ctx, err: l.err };
}

export function fromStored(l: StoredLogLine): UiLogLine {
  return { ts: Date.parse(l.time), level: l.level, source: l.src, area: l.area ?? "-", message: l.msg, ctx: l.ctx, err: l.err };
}

export const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogFilter {
  level: LogLevel;
  area: string;
  docId: string;
  jobId: string;
  q: string;
  hiddenSources: Set<string>;
}

export const EMPTY_FILTER: LogFilter = {
  level: "info",
  area: "",
  docId: "",
  jobId: "",
  q: "",
  hiddenSources: new Set(),
};

export function matches(l: UiLogLine, f: LogFilter): boolean {
  if (LEVEL_RANK[l.level] < LEVEL_RANK[f.level]) return false;
  if (f.hiddenSources.has(l.source)) return false;
  if (f.area && l.area !== f.area) return false;
  if (f.docId && l.ctx?.docId !== f.docId) return false;
  if (f.jobId && l.ctx?.jobId !== f.jobId) return false;
  if (f.q) {
    const hay = `${l.message} ${JSON.stringify(l.ctx ?? {})} ${l.err?.message ?? ""}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

export function formatTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function sourceColor(src: string): string {
  switch (src) {
    case "pm-app":
      return "text-sky-400";
    case "qwen-tts":
      return "text-fuchsia-400";
    case "arbiter":
      return "text-amber-400";
    case "ollama":
      return "text-emerald-400";
    case "docling":
      return "text-violet-400";
    default:
      return "text-neutral-400";
  }
}

export function levelColor(level: string): string {
  switch (level) {
    case "error":
      return "text-red-400";
    case "warn":
      return "text-amber-400";
    case "debug":
      return "text-neutral-500";
    default:
      return "text-neutral-300";
  }
}
