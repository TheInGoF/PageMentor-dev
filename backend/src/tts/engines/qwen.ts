/**
 * Qwen3-TTS-Engine — self-hosted TTS über einen vLLM-OpenAI-Server,
 * der `Qwen/Qwen3-TTS-Flash` mit `--task audio_speech` serviert.
 *
 * Wir sprechen vLLM ausschließlich über den pm-gpu-arbiter an
 * (`http://pm-gpu-arbiter:8790`), der serialisiert den GPU-Zugriff
 * gegen Ollama — siehe /pm-gpu-arbiter/ im Repo-Root.
 *
 * API: identisch zu OpenAIs `/v1/audio/speech`.
 *
 * Voice-Mapping: das Frontend sieht vier kuratierte DE-Labels
 * (Anna/Emma/Klaus/Max). Jedes Label mappt intern auf einen
 * Qwen-Built-in-Speaker-Namen, den vLLM direkt versteht — plus einen
 * festen Integer-Seed, damit dieselbe Voice run-to-run identisch
 * klingt (bei vLLM akzeptiert das OpenAI-Endpoint `seed` als
 * zusätzliches Feld im Request-Body; unbekannte Felder werden
 * ignoriert, also schadet es nichts falls eine Revision das Feature
 * mal nicht mehr mitbringt).
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
 *   3. Fallback `http://pm-gpu-arbiter:8790` — funktioniert nur wenn
 *      PageMentor im selben Compose-Netz wie der Arbiter läuft. Für
 *      den typischen NAS-Setup (PM auf NAS, Arbiter auf 3090-PC)
 *      trägt der User die IP im Settings-Modal ein.
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
/** vLLM startet ggf. kalt (Arbiter triggert Start) — großzügig
 *  bemessen, weil Modell-Load + Synthese eines langen Chunks locker
 *  2-3 min dauern können. */
const SYNTH_TIMEOUT_MS = 5 * 60_000;
const PREVIEW_TIMEOUT_MS = 60_000;

const REFRESH_TTL_MS = 5 * 60_000;
const REFRESH_RETRY_MS = 15_000;

interface VoiceBinding {
  /** Name des Qwen-Built-in-Speakers, den vLLM kennt. Falls ein
   *  Preset-Name in der aktuellen Qwen-Revision nicht mehr existiert,
   *  hier per ENV überschreibbar (siehe unten). */
  qwenSpeaker: string;
  /** Fester torch-Seed. Dieselbe Voice + derselbe Text = identisches
   *  Audio. vLLM reicht das Feld als Generation-Seed durch. */
  seed: number;
}

/**
 * Voice-Katalog + Mapping. Preset-Namen können via ENV überschrieben
 * werden, falls Qwen eine Revision rausbringt bei der die Namen
 * abweichen (`Cherry` → `cherry_v2` o. ä.).
 */
const BINDINGS: Record<string, VoiceBinding> = {
  de_f_anna: {
    qwenSpeaker: process.env.PM_QWEN_SPEAKER_F1 || "Cherry",
    seed: 101,
  },
  de_f_emma: {
    qwenSpeaker: process.env.PM_QWEN_SPEAKER_F2 || "Jada",
    seed: 102,
  },
  de_m_klaus: {
    qwenSpeaker: process.env.PM_QWEN_SPEAKER_M1 || "Ethan",
    seed: 201,
  },
  de_m_max: {
    qwenSpeaker: process.env.PM_QWEN_SPEAKER_M2 || "Nofish",
    seed: 202,
  },
};

const VOICES: Voice[] = [
  {
    id: "de_f_anna",
    label: "Anna (DE)",
    language: "de",
    locale: "de-DE",
    gender: "female",
    engine: "qwen",
    flagship: true,
    note: `Qwen3-TTS via vLLM · Speaker ${BINDINGS.de_f_anna.qwenSpeaker} · Seed ${BINDINGS.de_f_anna.seed}`,
  },
  {
    id: "de_f_emma",
    label: "Emma (DE)",
    language: "de",
    locale: "de-DE",
    gender: "female",
    engine: "qwen",
    note: `Qwen3-TTS via vLLM · Speaker ${BINDINGS.de_f_emma.qwenSpeaker} · Seed ${BINDINGS.de_f_emma.seed}`,
  },
  {
    id: "de_m_klaus",
    label: "Klaus (DE)",
    language: "de",
    locale: "de-DE",
    gender: "male",
    engine: "qwen",
    note: `Qwen3-TTS via vLLM · Speaker ${BINDINGS.de_m_klaus.qwenSpeaker} · Seed ${BINDINGS.de_m_klaus.seed}`,
  },
  {
    id: "de_m_max",
    label: "Max (DE)",
    language: "de",
    locale: "de-DE",
    gender: "male",
    engine: "qwen",
    note: `Qwen3-TTS via vLLM · Speaker ${BINDINGS.de_m_max.qwenSpeaker} · Seed ${BINDINGS.de_m_max.seed}`,
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
  return k ? { "Authorization": `Bearer ${k}` } : {};
}

async function discover(): Promise<void> {
  const url = baseUrl();
  try {
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

function bindingFor(voiceId: string): VoiceBinding {
  const b = BINDINGS[voiceId];
  if (!b) {
    // Unbekannte Voice (z. B. manuelles Testen mit einem Qwen-Namen
    // direkt) — Voice-ID als Speaker nehmen, Seed aus dem String-Hash.
    let h = 0;
    for (let i = 0; i < voiceId.length; i++) {
      h = (h * 31 + voiceId.charCodeAt(i)) | 0;
    }
    return { qwenSpeaker: voiceId, seed: Math.abs(h) };
  }
  return b;
}

async function callSpeech(params: {
  text: string;
  voice: string;
  speed: number;
  timeoutMs: number;
}): Promise<Buffer> {
  const binding = bindingFor(params.voice);
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
      voice: binding.qwenSpeaker,
      response_format: "mp3",
      speed: params.speed,
      // OpenAI-TTS kennt kein offizielles `seed`, vLLM akzeptiert es
      // aber als Generation-Parameter. Server, die das Feld nicht
      // kennen, ignorieren es — dann klingt die Stimme jede Generation
      // minimal anders, aber nichts bricht.
      seed: binding.seed,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, voice=${binding.qwenSpeaker}): ${detail.slice(0, 200)}`
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
