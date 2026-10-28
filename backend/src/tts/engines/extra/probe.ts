// Welche Engines der Arbiter kennt und ob ihr Container angelegt ist
import { baseUrl } from "../qwen/config";
import type { ExtraId } from "./config";

interface EngineStatus {
  container: string;
  gpu: boolean;
}

const TTL_MS = 60_000;
let engines: Record<string, EngineStatus> = {};
let checkedAt = 0;
let running: Promise<void> | null = null;

async function refresh(): Promise<void> {
  try {
    const res = await fetch(`${baseUrl()}/status`, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { engines?: Record<string, EngineStatus> };
    engines = data.engines ?? {};
  } catch {
    engines = {};
  }
  checkedAt = Date.now();
}

export function refreshExtraStatus(): Promise<void> {
  running ??= refresh().finally(() => (running = null));
  return running;
}

// Verfügbar = Arbiter kennt sie und der Container existiert (Profil an)
export function extraAvailable(id: ExtraId | "qwen"): boolean {
  if (Date.now() - checkedAt > TTL_MS) void refreshExtraStatus();
  const s = engines[id];
  return !!s && s.container !== "missing" && !s.container.startsWith("error");
}

// Qwen ist seit v1.21 optional; ein alter Arbiter ohne Engine-Liste kennt nur Qwen, dann gilt es als da
export function qwenInstalled(): boolean {
  if (Date.now() - checkedAt > TTL_MS) void refreshExtraStatus();
  return !Object.keys(engines).length || extraAvailable("qwen");
}

export function extraStatus(): Record<string, EngineStatus> {
  return engines;
}
