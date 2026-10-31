// Einstellungen und kleine Helfer der Qwen-Engine
import { effective } from "../../../services/llmConfig";

export const CUSTOM_VOICE_PREFIX = "custom:";
export const DESIGN_VOICE_PREFIX = "design:";

export function baseUrl(): string {
  const u =
    effective("qwenTtsUrl", "PM_QWEN_TTS_URL") ||
    process.env.PM_GPU_ARBITER_URL ||
    `http://${process.env.PM_ENGINE_HOST || "localhost"}:8790`;
  return u.replace(/\/+$/, "");
}

function apiKey(): string {
  return effective("qwenTtsApiKey", "PM_QWEN_TTS_API_KEY") || "";
}

export const MODEL = process.env.PM_QWEN_TTS_MODEL || "Qwen/Qwen3-TTS-12Hz-1.7B-Base";

export const DISCOVERY_TIMEOUT_MS = 5_000;
// Timeout pro Chunk: lange Chunks brauchen auf einer 3090 bis zu 8 min
// Per ENV überschreibbar
function envMs(name: string, defaultMs: number): number {
  const raw = parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(raw) || raw < 1_000) return defaultMs;
  return raw;
}
export const SYNTH_TIMEOUT_MS = envMs("PM_QWEN_TTS_SYNTH_TIMEOUT_MS", 20 * 60_000);
export const PREVIEW_TIMEOUT_MS = envMs("PM_QWEN_TTS_PREVIEW_TIMEOUT_MS", 5 * 60_000);

export function authHeaders(): Record<string, string> {
  const k = apiKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

export function parseRate(rate: string): number {
  const m = /^([+-])(\d+)%$/.exec(rate);
  if (!m) return 1.0;
  const sign = m[1] === "+" ? 1 : -1;
  const pct = parseInt(m[2], 10);
  return Math.max(0.5, Math.min(2.0, 1 + (sign * pct) / 100));
}

// Fester Seed pro Preset-Sprecher: kein Zufalls-Drift zwischen Chunks
export function seedForSpeaker(speaker: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < speaker.length; i++) {
    h ^= speaker.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % 2_147_483_647 || 42;
}

// Sprachname für die Sidecars (Qwen kennt 10 Sprachen, F5 wählt danach sein Modell)
const LANGUAGE_NAMES: Record<string, string> = { de: "German", en: "English", es: "Spanish", fr: "French", it: "Italian", pt: "Portuguese" };
export function qwenLanguageFor(lang: string): string {
  return LANGUAGE_NAMES[lang] ?? "English";
}

function parseNumConfig(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseIntConfig(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export interface AdvancedDials {
  temperature?: number;
  topP?: number;
  topK?: number;
  repetitionPenalty?: number;
}

export function readDials(): AdvancedDials {
  return {
    temperature: parseNumConfig(effective("qwenTtsTemperature", "PM_QWEN_TTS_TEMPERATURE")),
    topP: parseNumConfig(effective("qwenTtsTopP", "PM_QWEN_TTS_TOP_P")),
    topK: parseIntConfig(effective("qwenTtsTopK", "PM_QWEN_TTS_TOP_K")),
    repetitionPenalty: parseNumConfig(
      effective("qwenTtsRepetitionPenalty", "PM_QWEN_TTS_REPETITION_PENALTY")
    ),
  };
}
