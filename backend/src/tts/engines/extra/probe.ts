// Welche Engines der Arbiter kennt und ob ihr Container angelegt ist
import { baseUrl } from "../qwen/config";
import type { ExtraId } from "./config";

interface EngineStatus {
  container: string;
  gpu: boolean;
}

const TTL_MS = 60_000;
let engines: Record<string, EngineStatus> = {};
// Stimmen des Kokoro-Sidecars: Martin und Kerstin, mit Sprachpaket dazu z. B. "es:ef_dora"
let kokoroNames: string[] = ["martin", "kerstin"];
let checkedAt = 0;
let running: Promise<void> | null = null;

async function refresh(): Promise<void> {
  try {
    const res = await fetch(`${baseUrl()}/status`, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { engines?: Record<string, EngineStatus> };
    engines = data.engines ?? {};
    const kv = await fetch(`${baseUrl()}/tts/kokoro/v1/audio/voices`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (kv?.ok) {
      const list = ((await kv.json()) as { voices?: unknown[] }).voices;
      if (Array.isArray(list) && list.length) kokoroNames = list.map(String);
    }
  } catch {
    // Aussetzer (Arbiter wechselt gerade die Stimme): letzten bekannten Stand behalten,
    // sonst verschwinden Kokoro und Co. für eine Minute aus der Auswahl
  }
  checkedAt = Date.now();
}

export function refreshExtraStatus(): Promise<void> {
  running ??= refresh().finally(() => (running = null));
  return running;
}

// Gleich beim Start abfragen, damit die erste Stimmenliste schon alle Engines kennt
void refreshExtraStatus();

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

export function kokoroVoiceNames(): string[] {
  if (Date.now() - checkedAt > TTL_MS) void refreshExtraStatus();
  return kokoroNames;
}
