// Stimmen aus DB-Zeilen ableiten
import { getVoiceSample, type VoiceSample } from "../../../services/voiceSamples";
import { getVoiceDesign, type VoiceDesign } from "../../../services/voiceDesigns";
import type { Voice } from "../base";
import { CUSTOM_VOICE_PREFIX, DESIGN_VOICE_PREFIX } from "./config";

export function sampleToVoice(s: VoiceSample, idx: number): Voice {
  const locale =
    s.language === "de" ? "de-DE" : s.language === "en" ? "en-US" : s.language;
  return {
    id: `${CUSTOM_VOICE_PREFIX}${s.id}`,
    label: s.label,
    language: s.language,
    locale,
    gender: s.gender,
    engine: "qwen",
    // Erste Stimme der Sprache als Standard
    flagship: idx === 0,
    note: s.refText
      ? "Qwen3-TTS voice clone · with transcript reference"
      : "Qwen3-TTS voice clone · x-vector only",
    msPerChar: s.msPerChar,
    showInAudiobook: s.showInAudiobook,
  };
}

export function designToVoice(d: VoiceDesign): Voice {
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
    showInAudiobook: d.showInAudiobook,
  };
}

export function resolveSample(voiceId: string): VoiceSample | null {
  if (!voiceId.startsWith(CUSTOM_VOICE_PREFIX)) return null;
  const id = voiceId.slice(CUSTOM_VOICE_PREFIX.length);
  return getVoiceSample(id);
}

export function resolveDesign(voiceId: string): VoiceDesign | null {
  if (!voiceId.startsWith(DESIGN_VOICE_PREFIX)) return null;
  const id = voiceId.slice(DESIGN_VOICE_PREFIX.length);
  return getVoiceDesign(id);
}
