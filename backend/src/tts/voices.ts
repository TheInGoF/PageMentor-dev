/**
 * Voice-Katalog — Qwen3-TTS als einzige TTS-Engine.
 *
 * Self-hosted auf dem GPU-Host hinter dem pm-gpu-arbiter. Voices sind
 * User-Uploads aus SQLite (voice_samples-Tabelle) — kein Cloud-Fallback
 * mehr.
 */

import { qwenEngine } from "./engines/qwen";
import type { EngineId, TtsEngine, Voice } from "./engines/base";
import { hiddenPresetIds } from "../services/audioVoiceVisibility";

export type { EngineId, Voice } from "./engines/base";
export type TtsEngineType = EngineId;

const ENGINES: TtsEngine[] = [qwenEngine];

export function engineFor(id: EngineId): TtsEngine | undefined {
  return ENGINES.find((e) => e.id === id);
}

/** Lists every voice from every available engine, with the audiobook
 *  visibility flag attached:
 *    - voice_samples / voice_designs carry a per-row flag from the DB
 *      (engine fills it in when constructing the Voice).
 *    - preset voices are gated through the user-configurable hidden-set
 *      in `audioVoiceVisibility.hiddenPresetIds()`.
 *
 *  By default hides voices the user has deselected for the audiobook
 *  picker; pass `showHidden=true` (used by Settings) to list all. */
export function allVoices(showHidden: boolean = false): Voice[] {
  const all = ENGINES.flatMap((e) => (e.isAvailable() ? e.listVoices() : []));
  // hiddenPresetIds() touches llmConfig — read once per call.
  const hiddenPresets = hiddenPresetIds();
  const tagged = all.map((v) => {
    if (v.id.startsWith("preset:") && v.showInAudiobook === undefined) {
      return { ...v, showInAudiobook: !hiddenPresets.has(v.id) };
    }
    return v;
  });
  if (showHidden) return tagged;
  return tagged.filter((v) => v.showInAudiobook !== false);
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

/** Looks up a voice by ID across all engines, including hidden ones.
 *  Synthesis must work even for voices the user has hidden from the
 *  picker — finished audiobooks reference them by ID. */
export function findVoice(id: string): Voice | undefined {
  return allVoices(true).find((v) => v.id === id);
}
