/**
 * Qwen3-TTS-Engine — spricht den pm-qwen-tts Voice-Clone-Sidecar über
 * den pm-gpu-arbiter an.
 *
 * Voice-Katalog kommt rein aus der SQLite-Tabelle `voice_samples` —
 * der User lädt Referenz-Audio-Samples (3-10 s WAV/MP3) hoch, pro
 * Sample wird ein fester Seed gewürfelt. Die Engine lädt bei jedem
 * Synthese-Call die Referenz-Datei, base64-kodiert sie, und reicht
 * sie plus den Seed an den Sidecar durch.
 *
 * Determinismus: gleicher Seed + gleicher Referenz-Clip + gleicher
 * Text ⇒ identisches Audio. Der Seed wird in der DB persistiert und
 * nie geändert, bis der User das Sample löscht.
 *
 * Voice-ID-Konvention: `custom:<uuid>`. Der Präfix signalisiert dem
 * Engine-Code, dass der Rest eine voice_samples.id ist — andere
 * Präfixe könnten später built-in Voice-Packs o. ä. sein, ohne das
 * UI anzufassen.
 */

import { writeFile, unlink } from "fs/promises";
import { effective } from "../../services/llmConfig";
import {
  getVoiceSample,
  listVoiceSamples,
  readVoiceRefBytes,
  recordChunkTiming,
  type VoiceSample,
} from "../../services/voiceSamples";
import { applyAtempo } from "../ffmpeg";
import { listPresetVoices, speakerForPresetId } from "../presetVoices";
import type {
  TtsEngine,
  Voice,
  SynthesizeParams,
  SynthesizeResult,
  PreviewParams,
} from "./base";

const CUSTOM_VOICE_PREFIX = "custom:";

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

const MODEL = process.env.PM_QWEN_TTS_MODEL || "Qwen/Qwen3-TTS-12Hz-1.7B-Base";

const DISCOVERY_TIMEOUT_MS = 5_000;
// Qwen3-TTS-Base auf einer 3090 braucht ohne flash-attn gut 5-8 min für
// einen langen Chunk (Intros, volle Absätze). Mit flash-attn 2 eher 2-4
// min. 10 min Puffer verhindert, dass das Backend abschneidet bevor das
// Modell fertig ist — der Client-HTTP-Hop bleibt offen (kein Buffern)
// und Chrome/Firefox haben Default-Fetch-Timeout „nie".
const SYNTH_TIMEOUT_MS = 10 * 60_000;
const PREVIEW_TIMEOUT_MS = 3 * 60_000;

const REFRESH_TTL_MS = 5 * 60_000;
const REFRESH_RETRY_MS = 15_000;

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

function parseRate(rate: string): number {
  const m = /^([+-])(\d+)%$/.exec(rate);
  if (!m) return 1.0;
  const sign = m[1] === "+" ? 1 : -1;
  const pct = parseInt(m[2], 10);
  return Math.max(0.5, Math.min(2.0, 1 + (sign * pct) / 100));
}

function sampleToVoice(s: VoiceSample, idx: number): Voice {
  const locale =
    s.language === "de" ? "de-DE" : s.language === "en" ? "en-US" : s.language;
  return {
    id: `${CUSTOM_VOICE_PREFIX}${s.id}`,
    label: s.label,
    language: s.language,
    locale,
    gender: s.gender,
    engine: "qwen",
    // Erste Voice einer Sprache als Flagship markieren — damit der Audio-
    // Picker bei einem frischen Upload direkt einen Default wählt.
    flagship: idx === 0,
    note: s.refText
      ? "Qwen3-TTS Voice-Clone · mit Transkript-Referenz"
      : "Qwen3-TTS Voice-Clone · x-vector-only",
    msPerChar: s.msPerChar,
  };
}

function resolveSample(voiceId: string): VoiceSample | null {
  if (!voiceId.startsWith(CUSTOM_VOICE_PREFIX)) return null;
  const id = voiceId.slice(CUSTOM_VOICE_PREFIX.length);
  return getVoiceSample(id);
}

/** Deterministischer Seed pro Preset-Voice — gleicher Speaker → gleicher
 *  Seed → kein RNG-Drift zwischen Chunks. Speaker-Name als stabiles
 *  Identity-Token; Hash-Fold auf 32 Bit. */
function seedForSpeaker(speaker: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < speaker.length; i++) {
    h ^= speaker.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % 2_147_483_647 || 42;
}

function qwenLanguageFor(lang: string): string {
  return lang === "de" ? "German" : "English";
}

async function callSpeechClone(params: {
  text: string;
  sample: VoiceSample;
  speed: number;
  timeoutMs: number;
}): Promise<Buffer> {
  const url = baseUrl();
  const refBytes = readVoiceRefBytes(params.sample);
  const refB64 = refBytes.toString("base64");

  const res = await fetch(`${url}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      model: MODEL,
      input: params.text,
      voice: params.sample.id,            // nur für Logging im Sidecar
      response_format: "mp3",
      speed: params.speed,
      ref_audio_b64: refB64,
      ref_text: params.sample.refText ?? undefined,
      language: qwenLanguageFor(params.sample.language),
      seed: params.sample.seed,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, voice=${params.sample.id}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

async function callSpeechPreset(params: {
  text: string;
  speaker: string;
  instruct: string | undefined;
  language: string; // "de" | "en"
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
      voice: `preset:${params.speaker}`,
      response_format: "mp3",
      speed: 1.0,
      speaker: params.speaker,
      instruct: params.instruct || undefined,
      language: qwenLanguageFor(params.language),
      seed: seedForSpeaker(params.speaker),
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, preset=${params.speaker}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export const qwenEngine: TtsEngine = {
  id: "qwen",

  isAvailable: () => {
    maybeRefresh();
    // Engine ist auch „verfügbar" wenn Arbiter lebt aber noch keine
    // Samples hochgeladen sind — die listVoices-Liste ist dann leer,
    // also taucht keine Voice im Picker auf. Das ist die gewünschte UX.
    return probe.alive;
  },

  listVoices: () => {
    maybeRefresh();
    // Preset-Voices kommen aus dem CustomVoice-Modell (9 Speaker,
    // keine Stil-Drift zwischen Chunks) — immer anbieten, auch wenn
    // der User noch keine eigenen Samples hochgeladen hat.
    const presets = listPresetVoices();
    try {
      const customs = listVoiceSamples().map(sampleToVoice);
      return [...presets, ...customs];
    } catch (err) {
      console.warn(`[qwen-tts] listVoiceSamples failed:`, err);
      return presets;
    }
  },

  async synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
    const announce = params.announce ? `${params.announce}.\n\n` : "";
    const text = announce + params.segment.paragraphs.join("\n\n");
    const speed = parseRate(params.rate);
    const t0 = Date.now();

    const presetSpeaker = speakerForPresetId(params.voice.id);
    let buf: Buffer;

    if (presetSpeaker) {
      const instruct = effective("qwenTtsInstruction", "PM_QWEN_TTS_INSTRUCTION");
      console.log(
        `[qwen-tts] synth preset=${presetSpeaker} text=${text.length}c rate=${params.rate} instruct=${instruct ? "yes" : "no"}`
      );
      buf = await callSpeechPreset({
        text,
        speaker: presetSpeaker,
        instruct,
        language: params.voice.language,
        timeoutMs: SYNTH_TIMEOUT_MS,
      });
    } else {
      const sample = resolveSample(params.voice.id);
      if (!sample) {
        throw new Error(
          `Qwen-TTS voice sample ${params.voice.id} not found in DB`
        );
      }
      // Qwen-Base akzeptiert KEIN speed-Kwarg im generate_voice_clone —
      // das Tempo zieht's aus dem Referenz-Audio. Wir senden die
      // Rohausgabe und passen die Geschwindigkeit danach per ffmpeg
      // atempo an (ändert Tempo ohne Tonhöhe zu verschieben).
      console.log(
        `[qwen-tts] synth clone voice=${params.voice.id} text=${text.length}c rate=${params.rate}`
      );
      buf = await callSpeechClone({
        text,
        sample,
        speed: 1.0, // Info fürs Sidecar-Log, faktisch ignoriert
        timeoutMs: SYNTH_TIMEOUT_MS,
      });
    }
    console.log(
      `[qwen-tts] synth response voice=${params.voice.id} bytes=${buf.length} took=${((Date.now() - t0) / 1000).toFixed(1)}s`
    );

    if (buf.length === 0) {
      throw new Error(
        `Qwen-TTS returned empty audio for voice=${params.voice.id}`
      );
    }

    if (Math.abs(speed - 1.0) < 1e-3) {
      await writeFile(params.outPath, buf);
    } else {
      const rawPath = `${params.outPath}.raw.mp3`;
      await writeFile(rawPath, buf);
      try {
        await applyAtempo(rawPath, params.outPath, speed);
      } finally {
        try {
          await unlink(rawPath);
        } catch {
          /* best effort */
        }
      }
      console.log(
        `[qwen-tts] applied atempo=${speed.toFixed(3)} → ${params.outPath}`
      );
    }

    // Benchmark aktualisieren nur für Custom-Samples (da ist die ID
    // stabil in der DB). Preset-Voices teilen keinen Sample-Record —
    // ETA rechnet sich dann aus den laufenden Chunk-Messungen des
    // aktuellen Books neu zusammen.
    if (!presetSpeaker) {
      const sample = resolveSample(params.voice.id);
      if (sample) {
        try {
          recordChunkTiming(sample.id, text.length, Date.now() - t0);
        } catch (e) {
          console.warn("[qwen-tts] benchmark update failed:", e);
        }
      }
    }

    return { path: params.outPath, bytes: buf.length };
  },

  async preview(params: PreviewParams): Promise<Buffer> {
    const presetSpeaker = speakerForPresetId(params.voice.id);
    if (presetSpeaker) {
      const instruct =
        params.instructOverride !== undefined
          ? params.instructOverride
          : effective("qwenTtsInstruction", "PM_QWEN_TTS_INSTRUCTION");
      const buf = await callSpeechPreset({
        text: params.text,
        speaker: presetSpeaker,
        instruct,
        language: params.voice.language,
        timeoutMs: PREVIEW_TIMEOUT_MS,
      });
      if (buf.length === 0) {
        throw new Error(
          `Qwen-TTS preview returned empty audio for voice=${params.voice.id}`
        );
      }
      return buf;
    }

    const sample = resolveSample(params.voice.id);
    if (!sample) {
      throw new Error(
        `Qwen-TTS voice sample ${params.voice.id} not found in DB`
      );
    }
    const buf = await callSpeechClone({
      text: params.text,
      sample,
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
