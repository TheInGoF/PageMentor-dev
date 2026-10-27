// Zentrale Log-Ausgabe: Bus (Live-Ansicht + Datei) und Konsole
import { publish, type LogLine, type LogSource } from "../services/logBus";
import { currentContext } from "./context";
import { describeError, errorSummary } from "./errors";
import { redact } from "./redact";
import type { LogContext, LogLevel } from "./types";

// Ungepatchte Konsole, gesetzt von installConsoleTap
export const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

export interface EmitOptions {
  ctx?: LogContext;
  err?: unknown;
  source?: LogSource;
  // false: nicht auf stdout, z. B. für Sidecar-Zeilen
  print?: boolean;
}

// Leere Kontextfelder weglassen
function cleanCtx(ctx: LogContext): LogContext | undefined {
  const out: LogContext = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function emitLog(level: LogLevel, area: string, message: string, opts: EmitOptions = {}): void {
  try {
    const err = opts.err !== undefined ? describeError(opts.err) : undefined;
    let msg = redact(message);
    if (err && !msg.includes(err.message)) msg += ` — ${errorSummary(err)}`;
    const line: LogLine = {
      ts: Date.now(),
      source: opts.source ?? "pm-app",
      level,
      area,
      message: msg,
      ctx: cleanCtx({ ...currentContext(), ...opts.ctx }),
      err,
    };
    publish(line);
    if (opts.print !== false) printLine(line);
  } catch {
    // Logging darf nie werfen
  }
}

function printLine(line: LogLine): void {
  const ctx = line.ctx ? " " + Object.entries(line.ctx).map(([k, v]) => `${k}=${v}`).join(" ") : "";
  const text = `[${new Date(line.ts).toISOString()}] ${line.level.toUpperCase().padEnd(5)} ${line.area ?? "-"} ${line.message}${ctx}`;
  if (line.level === "error") rawConsole.error(text);
  else if (line.level === "warn") rawConsole.warn(text);
  else rawConsole.log(text);
  if (line.err?.stack && line.level === "error") rawConsole.error(line.err.stack);
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, err?: unknown, ctx?: LogContext): void;
  error(msg: string, err?: unknown, ctx?: LogContext): void;
  // Unterlogger mit festem Kontext, z. B. docId
  child(ctx: LogContext): Logger;
}

export function logger(area: string, base: LogContext = {}): Logger {
  return {
    debug: (msg, ctx) => emitLog("debug", area, msg, { ctx: { ...base, ...ctx } }),
    info: (msg, ctx) => emitLog("info", area, msg, { ctx: { ...base, ...ctx } }),
    warn: (msg, err, ctx) => emitLog("warn", area, msg, { err, ctx: { ...base, ...ctx } }),
    error: (msg, err, ctx) => emitLog("error", area, msg, { err, ctx: { ...base, ...ctx } }),
    child: (ctx) => logger(area, { ...base, ...ctx }),
  };
}

// Dauer eines Schritts messen und loggen, Fehler mit Ursache
export async function timed<T>(log: Logger, step: string, fn: () => Promise<T>, ctx?: LogContext): Promise<T> {
  const t0 = performance.now();
  log.info(`${step}: Start`, ctx);
  try {
    const result = await fn();
    log.info(`${step}: fertig`, { ...ctx, durationMs: Math.round(performance.now() - t0) });
    return result;
  } catch (err) {
    log.error(`${step}: fehlgeschlagen`, err, { ...ctx, durationMs: Math.round(performance.now() - t0) });
    throw err;
  }
}
