// Log-Dateien lesen und filtern, für die Logs-Seite
import { existsSync, readFileSync } from "fs";
import { appFile, listLogFiles } from "./files";
import { LEVEL_RANK, type LogLevel } from "./types";

export interface LogQuery {
  day: string;
  level?: LogLevel;
  area?: string;
  docId?: string;
  jobId?: string;
  q?: string;
  limit?: number;
}

export interface StoredLine {
  time: string;
  level: LogLevel;
  src: string;
  area?: string;
  msg: string;
  ctx?: Record<string, unknown>;
  err?: unknown;
}

export function listDays(): Array<{ day: string; size: number }> {
  return listLogFiles()
    .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f.name))
    .map((f) => ({ day: f.name.slice(4, 14), size: f.size }));
}

export function queryLogs(query: LogQuery): { lines: StoredLine[]; total: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.day)) return { lines: [], total: 0 };
  const file = appFile(query.day);
  if (!existsSync(file)) return { lines: [], total: 0 };
  const minRank = LEVEL_RANK[query.level ?? "debug"];
  const q = query.q?.toLowerCase();
  const out: StoredLine[] = [];
  let total = 0;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (!raw) continue;
    let line: StoredLine;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    total++;
    if (LEVEL_RANK[line.level] < minRank) continue;
    if (query.area && line.area !== query.area) continue;
    if (query.docId && line.ctx?.docId !== query.docId) continue;
    if (query.jobId && line.ctx?.jobId !== query.jobId) continue;
    if (q && !raw.toLowerCase().includes(q)) continue;
    out.push(line);
  }
  const limit = Math.min(Math.max(query.limit ?? 2000, 1), 20000);
  return { lines: out.slice(-limit), total };
}
