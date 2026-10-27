// Log-Dateien: app-JJJJ-MM-TT.log (JSON-Zeilen), startup.log, engine.log, crash-*.log
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { LOG_DIR } from "../paths";
import type { LogLine } from "../services/logBus";

export const KEEP_DAYS = 14;
let dirReady = false;

function ensureDir(): void {
  if (dirReady) return;
  mkdirSync(LOG_DIR, { recursive: true });
  dirReady = true;
}

// Lokales Datum: Dateinamen passen zur Uhr des Nutzers
export function localDay(ts: number = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function appFile(day: string): string {
  return join(LOG_DIR, `app-${day}.log`);
}

// Nie werfen: Logging darf den Aufrufer nicht stören
function safeAppend(file: string, text: string): void {
  try {
    ensureDir();
    appendFileSync(file, text, "utf8");
  } catch {
    // Datei gesperrt oder Platte voll
  }
}

export function appendAppLine(line: LogLine): void {
  const record = {
    time: new Date(line.ts).toISOString(),
    level: line.level,
    src: line.source,
    area: line.area,
    msg: line.message,
    ...(line.ctx && Object.keys(line.ctx).length ? { ctx: line.ctx } : {}),
    ...(line.err ? { err: line.err } : {}),
  };
  safeAppend(appFile(localDay(line.ts)), JSON.stringify(record) + "\n");
}

export function appendStartup(text: string): void {
  safeAppend(join(LOG_DIR, "startup.log"), text.endsWith("\n") ? text : text + "\n");
}

export function appendEngine(text: string): void {
  const stamp = new Date().toISOString();
  const lines = text.split("\n").filter((l) => l.length > 0).map((l) => `${stamp} ${l}`);
  safeAppend(join(LOG_DIR, "engine.log"), lines.join("\n") + "\n");
}

// Absturz-Bericht als eigene Datei, Rückgabe: Dateiname
export function writeCrash(kind: string, details: unknown): string | null {
  try {
    ensureDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `crash-${stamp}.log`;
    writeFileSync(join(LOG_DIR, name), JSON.stringify({ kind, time: new Date().toISOString(), details }, null, 2), "utf8");
    return name;
  } catch {
    return null;
  }
}

export interface LogFileInfo {
  name: string;
  size: number;
  mtime: number;
}

export function listLogFiles(): LogFileInfo[] {
  if (!existsSync(LOG_DIR)) return [];
  return readdirSync(LOG_DIR)
    .filter((n) => n.endsWith(".log") || n.endsWith(".zip"))
    .map((name) => {
      const st = statSync(join(LOG_DIR, name));
      return { name, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

// Alte Tages-, Absturz- und Diagnose-Dateien löschen
export function cleanupOldLogs(days: number = KEEP_DAYS): number {
  const limit = Date.now() - days * 86_400_000;
  let removed = 0;
  for (const f of listLogFiles()) {
    const rotating = /^(app-|crash-|diagnose-)/.test(f.name);
    if (rotating && f.mtime < limit) {
      try {
        unlinkSync(join(LOG_DIR, f.name));
        removed++;
      } catch {
        // gesperrt, nächstes Mal
      }
    }
  }
  return removed;
}
