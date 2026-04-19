/**
 * Qwen3-TTS-Engine — spricht den pm-qwen-tts-Sidecar an (FastAPI-Wrapper
 * um `Qwen/Qwen3-TTS-Flash`) über den pm-gpu-arbiter.
 *
 * Der Sidecar exponiert eine OpenAI-kompatible API (dieselbe Shape wie
 * Kokoro-FastAPI und OpenAI selbst):
 *   GET  /v1/audio/voices                   → Voice-Katalog
 *   POST /v1/audio/speech                   → Audio-Bytes
 *   GET  /v1/audio/voices/{id}/preview?text → Kurz-Preview
 *
 * Voice-ID-Mapping + Seed-Fixing macht der Sidecar — wir schicken
 * einfach unsere ID (`de_f_anna` etc.) und bekommen MP3 zurück. Dieselbe
 * Voice klingt zweimal hintereinander identisch, weil der Sidecar vor
 * jeder Generation `torch.manual_seed` mit einem pro-Voice fixen Wert
 * setzt.
 */

import { writeFile } from "fs/promises";
import { effective } from "../../services/llmConfig";
import type {
  TtsEngine,
  Voice,
  SynthesizeParams,
  SynthesizeResult,
  PreviewParams,
} from "./base";

/**
 * Auflösung der Upstream-URL:
 *   1. Settings-UI-Eintrag (qwenTtsUrl in llm-config.json)
 *   2. ENV `PM_QWEN_TTS_URL`
 *   3. Fallback `http://pm-gpu-arbiter:8790` — nur im gleichen Compose-
 *      Netz. Bei NAS-Setup trägt der User die 3090-IP in Settings ein.
 */
function baseUrl(): string {
  const u =
    effective("qwenTtsUrl", "PM_QWEN_TTS_URL") ||
    process.env.PM_GPU_ARBITER_URL ||
    "http://pm-gpu-arbiter:8790";
  return u.replace(/\/+$/, "");
}

function apiKey(): string {
  return effective("qwenTtsApiKey", "PM_QWEN_TTS_API_KEY") || "";
}

const MODEL = process.env.PM_QWEN_TTS_MODEL || "Qwen/Qwen3-TTS-Flash";

const DISCOVERY_TIMEOUT_MS = 5_000;
/** Sidecar-Cold-Start (Arbiter triggert Container-Start, Modell lädt aus
 *  HF-Cache) plus lange Synthese → 5 min Puffer. */
const SYNTH_TIMEOUT_MS = 5 * 60_000;
const PREVIEW_TIMEOUT_MS = 60_000;

const REFRESH_TTL_MS = 5 * 60_000;
const REFRESH_RETRY_MS = 15_000;

/**
 * Voice-Katalog — rein deklarativ. Das tatsächliche Qwen-Speaker-
 * Mapping + der Seed sitzen im Sidecar (pm-qwen-tts/main.py:
 * VOICES_CONFIG), damit Backend und Sidecar eine klare
 * Verantwortungs-Trennung haben.
 */
const VOICES: Voice[] = [
  {
    id: "de_f_anna",
    label: "Anna (DE)",
    language: "de",
    locale: "de-DE",
    gender: "female",
    engine: "qwen",
    flagship: true,
    note: "Qwen3-TTS-Flash · deterministischer Seed",
  },
  {
    id: "de_f_emma",
    label: "Emma (DE)",
    language: "de",
    locale: "de-DE",
    gender: "female",
    engine: "qwen",
    note: "Qwen3-TTS-Flash · deterministischer Seed",
  },
  {
    id: "de_m_klaus",
    label: "Klaus (DE)",
    language: "de",
    locale: "de-DE",
    gender: "male",
    engine: "qwen",
    note: "Qwen3-TTS-Flash · deterministischer Seed",
  },
  {
    id: "de_m_max",
    label: "Max (DE)",
    language: "de",
    locale: "de-DE",
    gender: "male",
    engine: "qwen",
    note: "Qwen3-TTS-Flash · deterministischer Seed",
  },
];

interface ProbeState {
  alive: boolean;
  refreshedAt: number;
}

let probe: ProbeState = { alive: false, refreshedAt: 0 };
let refreshing: Promise<void> | null = null;

function authHeaders(): Record<string, string> {
  const k = apiKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

async function discover(): Promise<void> {
  const url = baseUrl();
  try {
    // Arbiter antwortet auf /status ohne Lock zu akquirieren — billiger
    // Liveness-Check ohne Container-Wecker.
    const statusRes = await fetch(`${url}/status`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!statusRes.ok) {
      probe = { alive: false, refreshedAt: Date.now() };
      console.warn(`[qwen-tts] arbiter /status HTTP ${statusRes.status}`);
      return;
    }
    probe = { alive: true, refreshedAt: Date.now() };
    console.log(`[qwen-tts] ready via ${url} (model=${MODEL})`);
  } catch (err) {
    probe = { alive: false, refreshedAt: Date.now() };
    console.warn(
      `[qwen-tts] arbiter nicht erreichbar (${url}): ${(err as Error).message}`
    );
  }
}

function refreshOnce(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = discover().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

refreshOnce().catch(() => {});

function maybeRefresh(): void {
  const ttl = probe.alive ? REFRESH_TTL_MS : REFRESH_RETRY_MS;
  if (Date.now() - probe.refreshedAt > ttl) {
    refreshOnce().catch(() => {});
  }
}

/** Edge-Rate ("+10%", "-5%") → Qwen speed (0.5..2.0). */
function parseRate(rate: string): number {
  const m = /^([+-])(\d+)%$/.exec(rate);
  if (!m) return 1.0;
  const sign = m[1] === "+" ? 1 : -1;
  const pct = parseInt(m[2], 10);
  return Math.max(0.5, Math.min(2.0, 1 + (sign * pct) / 100));
}

async function callSpeech(params: {
  text: string;
  voice: string;
  speed: number;
  timeoutMs: number;
}): Promise<Buffer> {
  const url = baseUrl();
  const res = await fetch(`${url}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      model: MODEL,
      input: params.text,
      voice: params.voice,
      response_format: "mp3",
      speed: params.speed,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, voice=${params.voice}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export const qwenEngine: TtsEngine = {
  id: "qwen",

  isAvailable: () => {
    maybeRefresh();
    return probe.alive;
  },

  listVoices: () => {
    maybeRefresh();
    return VOICES;
  },

  async synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
    const announce = params.announce ? `${params.announce}.\n\n` : "";
    const text = announce + params.segment.paragraphs.join("\n\n");

    const buf = await callSpeech({
      text,
      voice: params.voice.id,
      speed: parseRate(params.rate),
      timeoutMs: SYNTH_TIMEOUT_MS,
    });

    if (buf.length === 0) {
      throw new Error(
        `Qwen-TTS returned empty audio for voice=${params.voice.id}`
      );
    }
    await writeFile(params.outPath, buf);
    return { path: params.outPath, bytes: buf.length };
  },

  async preview(params: PreviewParams): Promise<Buffer> {
    const buf = await callSpeech({
      text: params.text,
      voice: params.voice.id,
      speed: 1.0,
      timeoutMs: PREVIEW_TIMEOUT_MS,
    });
    if (buf.length === 0) {
      throw new Error(
        `Qwen-TTS preview returned empty audio for voice=${params.voice.id}`
      );
    }
    return buf;
  },
};
