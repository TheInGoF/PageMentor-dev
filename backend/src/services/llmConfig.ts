/**
 * Runtime-editable LLM config.
 *
 * On disk at `{PM_DATA_DIR}/llm-config.json`. When any field is set
 * here, it wins over the corresponding ENV variable. This lets users
 * point PageMentor at a different Ollama box or flip on the Claude
 * fallback from the Settings modal without redeploying.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";
const CONFIG_PATH = join(DATA_DIR, "llm-config.json");

export interface LlmConfig {
  ollamaUrlPc?: string;
  ollamaUrlMac?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  googleApiKey?: string;
  googleModel?: string;
  /** URL des pm-gpu-arbiter, hinter dem Qwen3-TTS sitzt. Default aus
   *  der ENV `PM_QWEN_TTS_URL`, im NAS-Setup zeigt das auf den
   *  3090-PC (z. B. `http://192.168.1.50:8790`). */
  qwenTtsUrl?: string;
  qwenTtsApiKey?: string;
  /** Freitext-Instruction-Prompt für Qwen3-TTS CustomVoice-Presets.
   *  Wird bei JEDEM Request an den Sidecar weitergereicht und steuert
   *  Tonfall / Tempo der Preset-Stimme. Leer = neutral.
   *  Beispiel: "Calm audiobook narrator, slow and clear pacing." */
  qwenTtsInstruction?: string;
  /** Sampling-Temperature für CustomVoice-Generate (0.0-1.5). Niedrig
   *  = deterministischer, straffer an Instruction; hoch = mehr
   *  Varianz/Emotion. Leer = Qwen-Default. Bei Akzent-Drift-Problemen
   *  (Vivian/ZH-Speaker driften zurück zu Chinese) lohnt ~0.3-0.5. */
  qwenTtsTemperature?: string;
  /** Top-P Sampling (0.0-1.0). Leer = Qwen-Default. */
  qwenTtsTopP?: string;
  /** Override für max_new_tokens des Qwen-Generate. Leer = Sidecar-
   *  Default (MAX_NEW_TOKENS, derzeit 4096). Hochsetzen nur bei
   *  extrem langen Chunks; meistens irrelevant weil wir zuvor auf
   *  ~1500 chars splitten. */
  qwenTtsMaxNewTokens?: string;
  /** Seed-Override (Int-String). Leer = Sidecar berechnet einen
   *  deterministischen Seed aus dem Speaker-Namen (FNV-Hash) —
   *  gleicher Speaker → gleiche Stimme über alle Sessions. Explizit
   *  gesetzt ermöglicht andere Varianten desselben Presets. */
  qwenTtsSeedOverride?: string;
}

let cached: LlmConfig | null = null;

export function getLlmConfig(): LlmConfig {
  if (cached) return cached;
  try {
    if (existsSync(CONFIG_PATH)) {
      const text = readFileSync(CONFIG_PATH, "utf-8");
      cached = JSON.parse(text) as LlmConfig;
      return cached;
    }
  } catch (err) {
    console.warn("[llm-config] failed to read config:", err);
  }
  cached = {};
  return cached;
}

export function setLlmConfig(patch: LlmConfig): LlmConfig {
  const next: LlmConfig = { ...getLlmConfig(), ...patch };
  // Drop empty strings so ENV defaults take over again.
  for (const k of Object.keys(next) as Array<keyof LlmConfig>) {
    if (next[k] === "" || next[k] === null) delete next[k];
  }
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  } catch (err) {
    console.warn("[llm-config] failed to persist config:", err);
  }
  cached = next;
  return next;
}

/** Effective value: DB override > ENV > undefined */
export function effective(key: keyof LlmConfig, envKey: string): string | undefined {
  const cfg = getLlmConfig()[key];
  if (cfg && cfg.length > 0) return cfg;
  const env = process.env[envKey];
  if (env && env.length > 0) return env;
  return undefined;
}

/** Sanitised view (never returns raw API keys) for the UI. */
export function publicConfig() {
  const cfg = getLlmConfig();
  const {
    anthropicApiKey,
    openaiApiKey,
    googleApiKey,
    qwenTtsApiKey,
    ...rest
  } = cfg;
  return {
    ...rest,
    anthropicApiKeyPresent: !!anthropicApiKey,
    openaiApiKeyPresent: !!openaiApiKey,
    googleApiKeyPresent: !!googleApiKey,
    qwenTtsApiKeyPresent: !!qwenTtsApiKey,
  };
}
