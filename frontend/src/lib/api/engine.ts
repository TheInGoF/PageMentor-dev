// API: Engine-Status, Selbsttest, Reparaturen
import { request } from "./request";

export type CheckStatus = "ok" | "warn" | "error" | "skipped";

export interface EngineCheck {
  id: string;
  title: string;
  status: CheckStatus;
  message: string;
  repair?: string;
  help?: string;
  durationMs?: number;
}

export interface EngineStatus {
  windows: boolean;
  results: EngineCheck[];
  checkedAt: number;
  checking: boolean;
  task: { repair: string; title: string; message: string; fraction?: number; startedAt: number } | null;
  lastError: string | null;
  autoStart: "aus" | "läuft" | "fertig" | "braucht-hilfe";
}

export interface TtsEnginesInfo {
  engines: Record<string, { service: string; title: string; sizeGb: number; alwaysOn: boolean }>;
  enabled: string[];
  hfTokenPresent: boolean;
  arbiter: Record<string, { container: string; gpu: boolean }>;
}

export interface KokoroPack {
  installed: boolean;
  downloading: boolean;
  fraction: number;
  error: string | null;
  available?: boolean;
}

// Zusätzliche Sprachmodelle für den Tutor; installed null = Ollama nicht erreichbar
export interface LlmModelsInfo {
  defaultModel: string;
  defaultBudget: { ctx: number; hits: number; turns: number };
  models: Record<string, { title: string; sizeGb: number; ctx: number; hits: number; turns: number }>;
  enabled: string[];
  installed: string[] | null;
  tutorModel: string;
  // Lernhörbuch: leer = Vorschlag (Gemma 26B für Sprachkurse, Qwen 3.6 für Fachhefte, wenn geladen)
  learnModelLanguage: string;
  learnModelSubject: string;
}

export const engineApi = {
  engine: {
    status: () => request<EngineStatus>("/api/engine/status"),
    selftest: () => request<{ results: EngineCheck[] }>("/api/engine/selftest", { method: "POST" }),
    quitApp: () => request<{ ok: boolean }>("/api/app/quit", { method: "POST" }),
    repair: (id: string) => request<{ started: boolean }>(`/api/engine/repair/${id}`, { method: "POST" }),
    ttsEngines: () => request<TtsEnginesInfo>("/api/engine/tts-engines"),
    kokoroPack: () => request<KokoroPack>("/api/engine/kokoro-pack"),
    installKokoroPack: () => request<KokoroPack>("/api/engine/kokoro-pack", { method: "POST" }),
    throttle: () => request<ThrottleInfo>("/api/engine/throttle"),
    setThrottle: (body: { pct?: number; remeasure?: boolean }) =>
      request<ThrottleInfo>("/api/engine/throttle", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    llmModels: () => request<LlmModelsInfo>("/api/engine/llm-models"),
    saveLlmModels: (body: { enabled: string[]; tutorModel: string; learnModelLanguage: string; learnModelSubject: string }) =>
      request<{ enabled: string[]; tutorModel: string; pulling: boolean }>("/api/engine/llm-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    saveTtsEngines: (enabled: string[], hfToken?: string) =>
      request<{ enabled: string[]; applying: boolean }>("/api/engine/tts-engines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, hfToken }),
      }),
  },
};

// Download-Bremse: Anteil der gemessenen Leitungsrate, Grenze in Mbit/s (null = ungebremst)
export interface ThrottleInfo {
  pct: number;
  maxMbit: number | null;
  limitMbit: number | null;
  measuring: boolean;
  error?: string;
  windows: boolean;
}
