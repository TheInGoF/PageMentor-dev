/**
 * Voice-Katalog — Qwen3-TTS als einzige TTS-Engine.
 *
 * Self-hosted auf dem GPU-Host hinter dem pm-gpu-arbiter. Voices sind
 * User-Uploads aus SQLite (voice_samples-Tabelle) — kein Cloud-Fallback
 * mehr.
 */

import { qwenEngine } from "./engines/qwen";
import type { EngineId, TtsEngine, Voice } from "./engines/base";

export type { EngineId, Voice } from "./engines/base";
export type TtsEngineType = EngineId;

const ENGINES: TtsEngine[] = [qwenEngine];

export function engineFor(id: EngineId): TtsEngine | undefined {
  return ENGINES.find((e) => e.id === id);
}

export function allVoices(): Voice[] {
  return ENGINES.flatMap((e) => (e.isAvailable() ? e.listVoices() : []));
}

export function defaultVoiceFor(language: string): string {
  if (qwenEngine.isAvailable()) {
    const qwenVoices = qwenEngine.listVoices();
    const flagship = qwenVoices.find(
      (v) => v.language === language && v.flagship
    );
    if (flagship) return flagship.id;
    const any = qwenVoices.find((v) => v.language === language);
    if (any) return any.id;
    return qwenVoices[0]?.id ?? "";
  }
  return "";
}

export function findVoice(id: string): Voice | undefined {
  return allVoices().find((v) => v.id === id);
}
