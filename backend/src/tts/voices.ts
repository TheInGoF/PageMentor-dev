/**
 * Voice-Katalog — Edge (Microsoft Neural Voices) als einzige Engine.
 *
 * Piper wurde in v1.11.001 entfernt: geringe Qualität für deutsche
 * Studientexte, großer Image-Overhead, zusätzliche Build-Pipeline.
 * Edge liefert (nach minimalem SSML-Template seit v1.10.006)
 * Studio-Qualität zuverlässig.
 */

import { edgeEngine } from "./engines/edge";
import type { EngineId, TtsEngine, Voice } from "./engines/base";

export type { EngineId, Voice } from "./engines/base";
export type TtsEngineType = EngineId;

const ENGINES: TtsEngine[] = [edgeEngine];

export function engineFor(id: EngineId): TtsEngine | undefined {
  return ENGINES.find((e) => e.id === id);
}

export function allVoices(): Voice[] {
  return ENGINES.flatMap((e) => (e.isAvailable() ? e.listVoices() : []));
}

export function defaultVoiceFor(language: string): string {
  const voices = allVoices();
  const flagship = voices.find((v) => v.language === language && v.flagship);
  if (flagship) return flagship.id;
  const any = voices.find((v) => v.language === language);
  return any?.id ?? voices[0]?.id ?? "";
}

export function findVoice(id: string): Voice | undefined {
  return allVoices().find((v) => v.id === id);
}
