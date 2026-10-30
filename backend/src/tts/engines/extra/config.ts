// Weitere TTS-Engines hinter dem Arbiter: Kokoro, F5, TADA
import { baseUrl } from "../qwen/config";
import type { EngineId } from "../base";

export type ExtraId = Exclude<EngineId, "qwen">;

export interface ExtraMeta {
  id: ExtraId;
  label: string;
  // Klont aus Stimmproben, sonst feste Stimme
  clones: boolean;
  // Kann das Tempo selbst, sonst ffmpeg atempo
  speed: boolean;
  note: string;
}

export const EXTRA: Record<ExtraId, ExtraMeta> = {
  kokoro: { id: "kokoro", label: "Kokoro", clones: false, speed: true, note: "Kokoro-82M Deutsch · schnell, läuft auf der CPU" },
  f5: { id: "f5", label: "F5-TTS", clones: true, speed: true, note: "F5-TTS German (HPI) · klont aus der Stimmprobe" },
  tada: { id: "tada", label: "TADA", clones: true, speed: false, note: "TADA 3B-ML (Hume AI) · klont aus der Stimmprobe" },
};

export const EXTRA_IDS = Object.keys(EXTRA) as ExtraId[];

export const speechUrl = (id: ExtraId) => `${baseUrl()}/tts/${id}/v1/audio/speech`;

// Kokoro: Martin und Kerstin je ein eigenes Modell im Image; mit Sprachpaket weitere Stimmen "<sprache>:<name>"
export const KOKORO_VOICES = [
  { id: "martin", label: "Martin", gender: "male" },
  { id: "kerstin", label: "Kerstin", gender: "female" },
] as const;

const PACK_LANG: Record<string, { language: string; locale: string; label: string }> = {
  "en-us": { language: "en", locale: "en-US", label: "Englisch (US)" },
  "en-gb": { language: "en", locale: "en-GB", label: "Englisch (UK)" },
  es: { language: "es", locale: "es-ES", label: "Spanisch" },
};

// "es:ef_dora" → Dora, weiblich, Spanisch; unbekannte Sprachen fallen weg
export function kokoroPackVoice(name: string): { id: string; label: string; gender: "female" | "male"; language: string; locale: string; langLabel: string } | null {
  const [lang, v] = name.split(":");
  const meta = PACK_LANG[lang];
  if (!meta || !v) return null;
  const base = v.split("_")[1] ?? v;
  return { id: name, label: base.charAt(0).toUpperCase() + base.slice(1), gender: v[1] === "m" ? "male" : "female", language: meta.language, locale: meta.locale, langLabel: meta.label };
}
