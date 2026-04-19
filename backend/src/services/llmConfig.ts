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
