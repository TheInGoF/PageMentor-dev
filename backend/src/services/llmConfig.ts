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
  /** URL of the pm-gpu-arbiter sitting in front of Qwen3-TTS. Default
   *  from the ENV `PM_QWEN_TTS_URL`; in the NAS setup this points at
   *  the 3090 PC (e.g. `http://192.168.1.50:8790`). */
  qwenTtsUrl?: string;
  qwenTtsApiKey?: string;
  /** Free-text instruction prompt for Qwen3-TTS CustomVoice presets.
   *  Forwarded to the sidecar on EVERY request and controls tone /
   *  pacing of the preset voice. Empty = neutral.
   *  Example: "Calm audiobook narrator, slow and clear pacing." */
  qwenTtsInstruction?: string;
  /** Sampling temperature for CustomVoice generate (0.0-1.5). Low
   *  = more deterministic, sticks tighter to the instruction; high
   *  = more variance/emotion. Empty = Qwen default. For accent-drift
   *  problems (Vivian/ZH speakers drift back to Chinese) ~0.3-0.5
   *  helps. */
  qwenTtsTemperature?: string;
  /** Top-P sampling (0.0-1.0). Empty = sidecar ENV default
   *  `QWEN_TTS_DEFAULT_TOP_P` (0.8). Tighter values (0.7-0.85) hold
   *  the timbre more stable across chunks. */
  qwenTtsTopP?: string;
  /** Top-K sampling (1-200). Empty = sidecar ENV default
   *  `QWEN_TTS_DEFAULT_TOP_K` (40). Caps the long-tail random tokens
   *  the AR decoder can pick from — lower values reduce drift but
   *  flatten prosody. */
  qwenTtsTopK?: string;
  /** Repetition penalty (≥ 1.0). Empty = sidecar ENV default
   *  `QWEN_TTS_DEFAULT_REPETITION_PENALTY` (1.05). Values around
   *  1.05-1.15 fight the looping/garble bug ([Qwen3-TTS issue
   *  #258](https://github.com/QwenLM/Qwen3-TTS/issues/258)) without
   *  hurting natural speech. */
  qwenTtsRepetitionPenalty?: string;
  /** Max. characters per TTS chunk (500-8000). Empty = 4000 default
   *  or ENV PM_TTS_MAX_CHUNK. Smaller values = faster fail-fast on
   *  problems, larger values = better prosody coherence but higher
   *  OOM/timeout risk depending on GPU. On the 3090, 4000 wasn't
   *  experimentally stable — 2000-2500 is safer. */
  ttsMaxChunk?: string;
  /** Comma-separated preset voice IDs that are hidden from the
   *  audiobook tab's voice picker. Default policy in
   *  `audioVoiceVisibility` hides the ZH/JP/KR-native presets so the
   *  picker doesn't drown in 30 entries; the user can override per
   *  preset in Settings. */
  hiddenAudiobookPresets?: string;
  /** Audiobookshelf server URL (e.g. http://192.168.188.5:13378).
   *  Empty = ABS integration disabled. */
  absUrl?: string;
  /** Audiobookshelf API token. Generate in ABS under Settings →
   *  Users → <your user> → API token. Bearer auth. */
  absApiKey?: string;
  /** Target library ID in Audiobookshelf (UUID). Listed via
   *  /api/libraries and picked by the user. Uploads always go there. */
  absLibraryId?: string;
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
    absApiKey,
    ...rest
  } = cfg;
  return {
    ...rest,
    anthropicApiKeyPresent: !!anthropicApiKey,
    openaiApiKeyPresent: !!openaiApiKey,
    googleApiKeyPresent: !!googleApiKey,
    qwenTtsApiKeyPresent: !!qwenTtsApiKey,
    absApiKeyPresent: !!absApiKey,
  };
}
