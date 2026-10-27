// Anfragen an /v1/audio/speech: Klon, Design, Preset
import { existsSync, readFileSync } from "fs";
import { readVoiceRefBytes, type VoiceSample } from "../../../services/voiceSamples";
import type { VoiceDesign } from "../../../services/voiceDesigns";
import {
  baseUrl,
  authHeaders,
  MODEL,
  qwenLanguageFor,
  seedForSpeaker,
  type AdvancedDials,
} from "./config";
import { ttsFetch } from "./http";

export async function callSpeechClone(params: {
  text: string;
  sample: VoiceSample;
  speed: number;
  timeoutMs: number;
  dials?: AdvancedDials;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const url = baseUrl();
  const d = params.dials ?? {};
  const refBytes = readVoiceRefBytes(params.sample);
  const refB64 = refBytes.toString("base64");

  const res = await ttsFetch(`${url}/v1/audio/speech`, {
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
      // Sprechstil pro Stimme, sonst driftet das Tempo zwischen Chunks
      instruct: params.sample.instruct || undefined,
      language: qwenLanguageFor(params.sample.language),
      seed: params.sample.seed,
      temperature: d.temperature,
      top_p: d.topP,
      top_k: d.topK,
      repetition_penalty: d.repetitionPenalty,
    }),
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, voice=${params.sample.id}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

// instruct für VoiceDesign, Geschlecht immer vorangestellt
// Qwen hat kein Geschlechtsfeld, das Dropdown ist maßgeblich
function buildDesignInstruct(design: VoiceDesign): string {
  const desc = design.description.trim();
  const prefix =
    design.gender === "female"
      ? "Female voice, soft feminine woman's speaking voice. "
      : "Male voice, deep masculine man's speaking voice. ";
  return prefix + desc;
}

// Design-Stimme über ihre Referenz klonen
// Klonen ist seed-stabil, VoiceDesign nicht
export async function callSpeechCloneFromDesign(params: {
  text: string;
  design: VoiceDesign;
  timeoutMs: number;
  dials?: AdvancedDials;
  signal?: AbortSignal;
}): Promise<Buffer> {
  if (!params.design.refPath || !existsSync(params.design.refPath)) {
    throw new Error(
      `Design ${params.design.id} has no reference audio — please re-create or call ensureDesignReference().`
    );
  }
  const url = baseUrl();
  const d = params.dials ?? {};
  const refBytes = readFileSync(params.design.refPath);
  const refB64 = refBytes.toString("base64");

  const res = await ttsFetch(`${url}/v1/audio/speech`, {
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
      // Beschreibung als instruct: gleichbleibender Stil
      instruct: params.design.description || undefined,
      language: qwenLanguageFor(params.design.language),
      seed: params.design.seed,
      // Gleiche Regler wie bei Preset und Sample
      temperature: d.temperature,
      top_p: d.topP,
      top_k: d.topK,
      repetition_penalty: d.repetitionPenalty,
    }),
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS-Clone-from-Design ${res.status} (design=${params.design.id}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function callSpeechDesign(params: {
  text: string;
  design: VoiceDesign;
  timeoutMs: number;
  dials?: AdvancedDials;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const url = baseUrl();
  const d = params.dials ?? {};

  const instructForQwen = buildDesignInstruct(params.design);

  const res = await ttsFetch(`${url}/v1/audio/speech`, {
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
      seed: params.design.seed,
      temperature: d.temperature,
      top_p: d.topP,
      top_k: d.topK,
      repetition_penalty: d.repetitionPenalty,
    }),
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, design=${params.design.id}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function callSpeechPreset(params: {
  text: string;
  speaker: string;
  instruct: string | undefined;
  language: string; // "de" | "en"
  timeoutMs: number;
  dials?: AdvancedDials;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const url = baseUrl();
  const d = params.dials ?? {};

  const res = await ttsFetch(`${url}/v1/audio/speech`, {
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
      temperature: d.temperature,
      top_p: d.topP,
      top_k: d.topK,
      repetition_penalty: d.repetitionPenalty,
    }),
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, preset=${params.speaker}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}
