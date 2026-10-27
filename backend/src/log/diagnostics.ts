// Diagnosepaket: Logs, System, Einstellungen ohne Geheimnisse, als ZIP
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { arch, cpus, freemem, release, totalmem, uptime, version as osVersion } from "os";
import { DATA_DIR, LOG_DIR } from "../paths";
import { APP_VERSION } from "../version";
import { recent } from "../services/logBus";
import { appFile, listLogFiles, localDay } from "./files";
import { describeError } from "./errors";
import { emitLog } from "./logger";
import { redact } from "./redact";
import { buildZip, type ZipEntry } from "./zip";

const DAYS = 3;
const MAX_TEXT = 5 * 1024 * 1024;

// Weitere Inhalte, z. B. Selbsttest, Tool-Pfade, Einstellungen
const providers = new Map<string, () => unknown | Promise<unknown>>();

export function registerDiagnostic(name: string, fn: () => unknown | Promise<unknown>): void {
  providers.set(name, fn);
}

function tail(text: string, max: number = MAX_TEXT): string {
  return text.length > max ? text.slice(text.length - max) : text;
}

function readIfExists(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

function systemInfo() {
  return {
    app: APP_VERSION,
    created: new Date().toISOString(),
    platform: process.platform,
    arch: arch(),
    os: `${release()} ${safe(osVersion)}`,
    bun: Bun.version,
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    ramGb: +(totalmem() / 1024 ** 3).toFixed(1),
    freeRamGb: +(freemem() / 1024 ** 3).toFixed(1),
    uptimeH: +(uptime() / 3600).toFixed(1),
    appUptimeMin: +(process.uptime() / 60).toFixed(1),
    dataDir: DATA_DIR,
    logDir: LOG_DIR,
    cwd: process.cwd(),
  };
}

function safe(fn: () => string): string {
  try {
    return fn();
  } catch {
    return "?";
  }
}

export async function createDiagnosticBundle(): Promise<{ name: string; size: number }> {
  const entries: ZipEntry[] = [];
  const now = Date.now();
  for (let i = 0; i < DAYS; i++) {
    const day = localDay(now - i * 86_400_000);
    const text = readIfExists(appFile(day));
    if (text) entries.push({ name: `logs/app-${day}.log`, data: tail(text) });
  }
  for (const f of ["startup.log", "engine.log"]) {
    const text = readIfExists(join(LOG_DIR, f));
    if (text) entries.push({ name: `logs/${f}`, data: tail(text, 1024 * 1024) });
  }
  const files = listLogFiles();
  for (const f of files.filter((x) => x.name.startsWith("crash-")).slice(0, 10)) {
    entries.push({ name: `crashes/${f.name}`, data: readIfExists(join(LOG_DIR, f.name)) ?? "" });
  }
  for (const f of files.filter((x) => /^(install|setup).*\.log$/i.test(x.name))) {
    entries.push({ name: `installer/${f.name}`, data: tail(readIfExists(join(LOG_DIR, f.name)) ?? "") });
  }
  entries.push({ name: "recent.jsonl", data: recent().map((l) => JSON.stringify(l)).join("\n") });
  entries.push({ name: "system.json", data: JSON.stringify(systemInfo(), null, 2) });
  for (const [name, fn] of providers) {
    let data: unknown;
    try {
      data = await fn();
    } catch (err) {
      data = { fehler: describeError(err) };
    }
    entries.push({ name: `${name}.json`, data: redact(JSON.stringify(data, null, 2)) });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `diagnose-${stamp}.zip`;
  const zip = buildZip(entries);
  writeFileSync(join(LOG_DIR, name), zip);
  emitLog("info", "diagnose", `Diagnosepaket erstellt: ${name} (${entries.length} Dateien, ${Math.round(zip.length / 1024)} KB)`);
  return { name, size: zip.length };
}
