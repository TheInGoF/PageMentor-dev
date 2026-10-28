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

// Kokoro: je Stimme ein eigenes Modell im Image pm-kokoro-tts
export const KOKORO_VOICES = [
  { id: "martin", label: "Martin", gender: "male" },
  { id: "kerstin", label: "Kerstin", gender: "female" },
] as const;
