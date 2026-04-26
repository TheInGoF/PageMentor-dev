/**
 * Qwen3-TTS engine — talks to the pm-qwen-tts voice-clone sidecar via
 * the pm-gpu-arbiter.
 *
 * The voice catalog comes purely from the SQLite `voice_samples` table:
 * the user uploads reference audio samples (3-10 s WAV/MP3), and a
 * fixed seed is rolled per sample. On each synthesis call the engine
 * loads the reference file, base64-encodes it, and forwards it plus
 * the seed to the sidecar.
 *
 * Determinism: same seed + same reference clip + same text ⇒
 * identical audio. The seed is persisted in the DB and never changed
 * until the user deletes the sample.
 *
 * Voice-ID convention: `custom:<uuid>`. The prefix signals to engine
 * code that the rest is a voice_samples.id — other prefixes could
 * later be built-in voice packs etc., without touching the UI.
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
import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  designRefPath,
  getVoiceDesign,
  listVoiceDesigns,
  recordDesignChunkTiming,
  setDesignReference,
  type VoiceDesign,
} from "../../services/voiceDesigns";
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
const DESIGN_VOICE_PREFIX = "design:";

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
// Qwen3-TTS-Base on a 3090 needs roughly 5-8 min for a long chunk
// (intros, full paragraphs) without flash-attn. With flash-attn 2 it's
// closer to 2-4 min. Default is now 20 min so even 4000-character
// chunks (raised via PM_TTS_MAX_CHUNK) don't time out. Override via
// ENV if a tight server needs stricter fail-fast.
function envMs(name: string, defaultMs: number): number {
  const raw = parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(raw) || raw < 1_000) return defaultMs;
  return raw;
}
const SYNTH_TIMEOUT_MS = envMs("PM_QWEN_TTS_SYNTH_TIMEOUT_MS", 20 * 60_000);
const PREVIEW_TIMEOUT_MS = envMs("PM_QWEN_TTS_PREVIEW_TIMEOUT_MS", 5 * 60_000);

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
      `[qwen-tts] arbiter unreachable (${url}): ${(err as Error).message}`
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
    // Mark the first voice of a language as flagship so the audio
    // picker auto-selects a default after a fresh upload.
    flagship: idx === 0,
    note: s.refText
      ? "Qwen3-TTS voice clone · with transcript reference"
      : "Qwen3-TTS voice clone · x-vector only",
    msPerChar: s.msPerChar,
  };
}

function designToVoice(d: VoiceDesign): Voice {
  const locale =
    d.language === "de" ? "de-DE" : d.language === "en" ? "en-US" : d.language;
  const hint = d.description.slice(0, 60).replace(/\s+/g, " ").trim();
  return {
    id: `${DESIGN_VOICE_PREFIX}${d.id}`,
    label: `${d.label} · Design`,
    language: d.language,
    locale,
    gender: d.gender,
    engine: "qwen",
    flagship: false,
    note: `Qwen3-TTS VoiceDesign · "${hint}${hint.length === 60 ? "…" : ""}"`,
    msPerChar: d.msPerChar,
  };
}

function resolveSample(voiceId: string): VoiceSample | null {
  if (!voiceId.startsWith(CUSTOM_VOICE_PREFIX)) return null;
  const id = voiceId.slice(CUSTOM_VOICE_PREFIX.length);
  return getVoiceSample(id);
}

function resolveDesign(voiceId: string): VoiceDesign | null {
  if (!voiceId.startsWith(DESIGN_VOICE_PREFIX)) return null;
  const id = voiceId.slice(DESIGN_VOICE_PREFIX.length);
  return getVoiceDesign(id);
}

/** Deterministic seed per preset voice — same speaker → same seed →
 *  no RNG drift between chunks. Speaker name as a stable identity
 *  token; hash folded to 32 bits. */
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
      voice: params.sample.id,            // only for sidecar logging
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

interface AdvancedDials {
  temperature?: number;
  topP?: number;
  maxNewTokens?: number;
  seedOverride?: number;
}

function readDials(): AdvancedDials {
  return {
    temperature: parseNumConfig(effective("qwenTtsTemperature", "PM_QWEN_TTS_TEMPERATURE")),
    topP: parseNumConfig(effective("qwenTtsTopP", "PM_QWEN_TTS_TOP_P")),
    maxNewTokens: parseIntConfig(effective("qwenTtsMaxNewTokens", "PM_QWEN_TTS_MAX_NEW_TOKENS")),
    seedOverride: parseIntConfig(effective("qwenTtsSeedOverride", "PM_QWEN_TTS_SEED_OVERRIDE")),
  };
}

/** Builds the `instruct` prompt for Qwen VoiceDesign. Prepending a
 *  gender cue is needed because Qwen itself has no gender field — the
 *  UI dropdown would otherwise have no effect.
 *
 *  There used to be a skip when the description already contained a
 *  gender word — the heuristic was too fragile (DE "Erzähler" also
 *  matched in "Hörbuch-Erzähler" and suppressed the female prefix
 *  even though female was selected). Now: ALWAYS prefix, the dropdown
 *  is authoritative. If the description redundantly mentions gender
 *  ("Erzählerin"), no harm done — Qwen responds more strongly to the
 *  first tokens than to repeated cues later. */
function buildDesignInstruct(design: VoiceDesign): string {
  const desc = design.description.trim();
  const prefix =
    design.gender === "female"
      ? "Female voice, soft feminine woman's speaking voice. "
      : "Male voice, deep masculine man's speaking voice. ";
  return prefix + desc;
}

/** Sends text + design reference audio as a base voice-clone request
 *  to the sidecar. This keeps voice identity stable across all
 *  chunks — base clone IS seed-deterministic, VoiceDesign isn't.
 *  Official "Voice Design then Clone" pattern from the Qwen3-TTS
 *  README.
 */
async function callSpeechCloneFromDesign(params: {
  text: string;
  design: VoiceDesign;
  timeoutMs: number;
}): Promise<Buffer> {
  if (!params.design.refPath || !existsSync(params.design.refPath)) {
    throw new Error(
      `Design ${params.design.id} has no reference audio — please re-create or call ensureDesignReference().`
    );
  }
  const url = baseUrl();
  const refBytes = readFileSync(params.design.refPath);
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
      voice: `design:${params.design.id}`,
      response_format: "mp3",
      speed: 1.0,
      ref_audio_b64: refB64,
      ref_text: params.design.refText ?? undefined,
      language: qwenLanguageFor(params.design.language),
      seed: params.design.seed,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS-Clone-from-Design ${res.status} (design=${params.design.id}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Ensures a design voice has a reference audio file on disk. If not,
 *  it is generated ONCE via VoiceDesign, the result is saved as MP3
 *  and the DB row is updated. Afterwards `design.refPath` points to
 *  the file. Returns the updated design.
 *
 *  Needed for old designs from v1.18.025-v1.18.032 (before the
 *  clone-pattern refactor) and as a server-side fallback when the
 *  client doesn't send a blob on create.
 */
export async function ensureDesignReference(
  design: VoiceDesign,
  timeoutMs: number = 3 * 60_000
): Promise<VoiceDesign> {
  if (design.refPath && existsSync(design.refPath)) return design;

  // Short reference text (~5-7 s audio) — Qwen-Base clone expects
  // 3-10 s. Longer references produce gibberish in synthesis.
  const refText =
    design.language === "de"
      ? "Hallo, dies ist eine Sprachprobe dieser Stimme. So klingt sie beim Vorlesen eines Textes."
      : "Hello, this is a voice sample. This is how it sounds when reading a book.";

  console.log(
    `[qwen-tts] ensuring reference audio for design ${design.id} — generating via VoiceDesign (one-time)`
  );
  const buf = await previewDesignUnsaved({
    text: refText,
    description: design.description,
    gender: design.gender,
    language: design.language,
    seed: design.seed,
    timeoutMs,
  });
  const path = designRefPath(design.id);
  writeFileSync(path, buf);
  setDesignReference(design.id, path, refText);
  console.log(
    `[qwen-tts] design ${design.id} reference saved to ${path} (${buf.length} bytes)`
  );
  return { ...design, refPath: path, refText };
}

/** Preview synthesis for a NOT-YET-saved voice design — used by the
 *  settings form before the design row is persisted to the DB.
 *  Allows seed reroll without an insert-delete dance. The result is
 *  NOT benchmarked (no DB row to update).
 *
 *  Dials default = llm-config. That way the wizard preview sounds
 *  identical to the later audiobook synthesis (both read the same
 *  temperature/top_p/seed overrides from the config). When the
 *  caller supplies `dials`, those take precedence — for live UI
 *  tuning. */
export async function previewDesignUnsaved(params: {
  text: string;
  description: string;
  gender: "female" | "male";
  language: string;
  seed: number;
  timeoutMs: number;
  dials?: AdvancedDials;
}): Promise<Buffer> {
  const ephemeral: VoiceDesign = {
    id: "ephemeral-preview",
    label: "preview",
    gender: params.gender,
    language: params.language,
    description: params.description,
    seed: params.seed,
    createdAt: "",
    msPerChar: null,
    samplesCount: 0,
    refPath: null,
    refText: null,
  };
  return callSpeechDesign({
    text: params.text,
    design: ephemeral,
    timeoutMs: params.timeoutMs,
    dials: params.dials ?? readDials(),
  });
}

async function callSpeechDesign(params: {
  text: string;
  design: VoiceDesign;
  timeoutMs: number;
  dials?: AdvancedDials;
}): Promise<Buffer> {
  const url = baseUrl();
  const d = params.dials ?? {};
  const seed =
    d.seedOverride !== undefined && Number.isFinite(d.seedOverride)
      ? d.seedOverride
      : params.design.seed;

  const instructForQwen = buildDesignInstruct(params.design);

  const res = await fetch(`${url}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      model: MODEL,
      input: params.text,
      voice: `design:${params.design.id}`,
      response_format: "mp3",
      speed: 1.0,
      voice_description: instructForQwen,
      language: qwenLanguageFor(params.design.language),
      seed,
      temperature: d.temperature,
      top_p: d.topP,
      max_new_tokens_override: d.maxNewTokens,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, design=${params.design.id}): ${detail.slice(0, 200)}`
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
  dials?: AdvancedDials;
}): Promise<Buffer> {
  const url = baseUrl();
  const d = params.dials ?? {};
  const seed =
    d.seedOverride !== undefined && Number.isFinite(d.seedOverride)
      ? d.seedOverride
      : seedForSpeaker(params.speaker);

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
      seed,
      temperature: d.temperature,
      top_p: d.topP,
      max_new_tokens_override: d.maxNewTokens,
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
    // The engine is also "available" if the arbiter is alive but no
    // samples have been uploaded yet — listVoices is then empty, so
    // no voice shows up in the picker. That's the intended UX.
    return probe.alive;
  },

  listVoices: () => {
    maybeRefresh();
    // Preset voices come from the CustomVoice model (9 speakers, no
    // style drift between chunks) — always offer them, even when the
    // user hasn't uploaded any custom samples yet.
    const presets = listPresetVoices();
    let designs: Voice[] = [];
    try {
      designs = listVoiceDesigns().map(designToVoice);
    } catch (err) {
      console.warn(`[qwen-tts] listVoiceDesigns failed:`, err);
    }
    try {
      const customs = listVoiceSamples().map(sampleToVoice);
      return [...presets, ...designs, ...customs];
    } catch (err) {
      console.warn(`[qwen-tts] listVoiceSamples failed:`, err);
      return [...presets, ...designs];
    }
  },

  async synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
    const announce = params.announce ? `${params.announce}.\n\n` : "";
    const text = announce + params.segment.paragraphs.join("\n\n");
    const speed = parseRate(params.rate);
    const t0 = Date.now();

    const presetSpeaker = speakerForPresetId(params.voice.id);
    const design = resolveDesign(params.voice.id);
    let buf: Buffer;

    if (design) {
      // Official Qwen pattern: bounce the design voice to a reference
      // once, then render via base clone. That is seed-stable —
      // every chunk gets the same voice identity. Calling VoiceDesign
      // directly per chunk would not be.
      const ready = await ensureDesignReference(design, SYNTH_TIMEOUT_MS);
      console.log(
        `[qwen-tts] synth design=${ready.id} (${ready.label}) via clone text=${text.length}c rate=${params.rate} seed=${ready.seed}`
      );
      buf = await callSpeechCloneFromDesign({
        text,
        design: ready,
        timeoutMs: SYNTH_TIMEOUT_MS,
      });
    } else if (presetSpeaker) {
      const instruct = effective("qwenTtsInstruction", "PM_QWEN_TTS_INSTRUCTION");
      const dials = readDials();
      console.log(
        `[qwen-tts] synth preset=${presetSpeaker} text=${text.length}c rate=${params.rate} ` +
          `instruct=${instruct ? "yes" : "no"} temp=${dials.temperature ?? "def"} ` +
          `top_p=${dials.topP ?? "def"} seedOverride=${dials.seedOverride ?? "auto"}`
      );
      buf = await callSpeechPreset({
        text,
        speaker: presetSpeaker,
        instruct,
        language: params.voice.language,
        timeoutMs: SYNTH_TIMEOUT_MS,
        dials,
      });
    } else {
      const sample = resolveSample(params.voice.id);
      if (!sample) {
        throw new Error(
          `Qwen-TTS voice sample ${params.voice.id} not found in DB`
        );
      }
      // Qwen-Base does NOT accept a speed kwarg in generate_voice_clone
      // — it pulls tempo from the reference audio. We send the raw
      // output and adjust speed afterwards via ffmpeg atempo
      // (changes tempo without shifting pitch).
      console.log(
        `[qwen-tts] synth clone voice=${params.voice.id} text=${text.length}c rate=${params.rate}`
      );
      buf = await callSpeechClone({
        text,
        sample,
        speed: 1.0, // info for the sidecar log, effectively ignored
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

    // Benchmark updates: preset voices share no DB record, so skip.
    // Custom samples and designs each have their own ID-stable table —
    // bump the ETA EMA there.
    if (design) {
      try {
        recordDesignChunkTiming(design.id, text.length, Date.now() - t0);
      } catch (e) {
        console.warn("[qwen-tts] design benchmark update failed:", e);
      }
    } else if (!presetSpeaker) {
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
    const design = resolveDesign(params.voice.id);
    if (design) {
      // Preview for a SAVED design voice goes via clone — the same
      // stable voice the user will hear in the audiobook.
      const ready = await ensureDesignReference(design, PREVIEW_TIMEOUT_MS);
      const buf = await callSpeechCloneFromDesign({
        text: params.text,
        design: ready,
        timeoutMs: PREVIEW_TIMEOUT_MS,
      });
      if (buf.length === 0) {
        throw new Error(
          `Qwen-TTS preview returned empty audio for voice=${params.voice.id}`
        );
      }
      return buf;
    }

    const presetSpeaker = speakerForPresetId(params.voice.id);
    if (presetSpeaker) {
      const instruct =
        params.instructOverride !== undefined
          ? params.instructOverride
          : effective("qwenTtsInstruction", "PM_QWEN_TTS_INSTRUCTION");
      // Preview uses the same dials as production synthesis — the user
      // hears exactly what generation will produce. Per-request
      // overrides (tester UI) take precedence over config defaults.
      const base = readDials();
      const dials: AdvancedDials = {
        temperature:
          params.temperatureOverride !== undefined
            ? params.temperatureOverride
            : base.temperature,
        topP:
          params.topPOverride !== undefined
            ? params.topPOverride
            : base.topP,
        maxNewTokens:
          params.maxNewTokensOverride !== undefined
            ? params.maxNewTokensOverride
            : base.maxNewTokens,
        seedOverride:
          params.seedOverride !== undefined
            ? params.seedOverride
            : base.seedOverride,
      };
      const buf = await callSpeechPreset({
        text: params.text,
        speaker: presetSpeaker,
        instruct,
        language: params.voice.language,
        timeoutMs: PREVIEW_TIMEOUT_MS,
        dials,
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
