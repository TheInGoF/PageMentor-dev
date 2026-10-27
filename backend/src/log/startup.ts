// Startprotokoll: jeder Start als Block in startup.log, Schritte mit Dauer
import { release, version as osVersion, totalmem, freemem, hostname } from "os";
import { appendStartup } from "./files";
import { describeError, errorSummary } from "./errors";
import { emitLog } from "./logger";

const startedAt = Date.now();

function stamp(): string {
  return new Date().toISOString();
}

export function startupHeader(appVersion: string, info: Record<string, unknown>): void {
  const lines = [
    "",
    `==================== Start ${stamp()} ====================`,
    `PageMentor ${appVersion}`,
    `System: ${process.platform} ${release()} (${safe(() => osVersion())}) · Bun ${Bun.version} · PID ${process.pid}`,
    `Rechner: ${hostname()} · RAM ${gb(totalmem())} GB, frei ${gb(freemem())} GB`,
    ...Object.entries(info).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
  ];
  appendStartup(lines.join("\n"));
  emitLog("info", "startup", `PageMentor ${appVersion} startet`, { ctx: info as Record<string, unknown> });
}

// Startschritt ausführen, Dauer und Ergebnis protokollieren
export async function startupStep<T>(name: string, fn: () => T | Promise<T>): Promise<T | undefined> {
  const t0 = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - t0);
    appendStartup(`${stamp()} OK     ${name} (${ms} ms)`);
    emitLog("info", "startup", `${name}: ok`, { ctx: { durationMs: ms } });
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    appendStartup(`${stamp()} FEHLER ${name} (${ms} ms): ${errorSummary(describeError(err))}`);
    emitLog("error", "startup", `${name}: fehlgeschlagen`, { err, ctx: { durationMs: ms } });
    return undefined;
  }
}

export function startupNote(text: string): void {
  appendStartup(`${stamp()} INFO   ${text}`);
  emitLog("info", "startup", text);
}

export function startupDone(): void {
  const ms = Date.now() - startedAt;
  appendStartup(`${stamp()} Bereit nach ${ms} ms`);
  emitLog("info", "startup", `Bereit nach ${ms} ms`);
}

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function safe(fn: () => string): string {
  try {
    return fn();
  } catch {
    return "?";
  }
}
