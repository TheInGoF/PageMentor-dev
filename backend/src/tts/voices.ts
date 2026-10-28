/**
 * Voice-Katalog über alle Engines hinter dem pm-gpu-arbiter.
 *
 * Kokoro ist Standard (Martin, Kerstin), Qwen3-TTS, F5 und TADA sind
 * optional. Eigene Stimmen sind User-Uploads aus SQLite.
 */

import { qwenEngine } from "./engines/qwen";
import { f5Engine, kokoroEngine, tadaEngine } from "./engines/extra/engine";
import type { EngineId, TtsEngine, Voice } from "./engines/base";
import { hiddenPresetIds } from "../services/audioVoiceVisibility";

export type { EngineId, Voice } from "./engines/base";
export type TtsEngineType = EngineId;

// Reihenfolge = Reihenfolge in der Auswahl; Kokoro ist Standard
const ENGINES: TtsEngine[] = [kokoroEngine, qwenEngine, f5Engine, tadaEngine];

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
  // Kokoro spricht nur Deutsch
  if (kokoroEngine.isAvailable()) {
    const k = kokoroEngine.listVoices().find((v) => v.language === language && v.flagship);
    if (k) return k.id;
  }
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
 *  picker — finished audiobooks reference them by ID.
 *
 *  Preset voices share one ID across their language variants
 *  ("preset:Ryan" exists for de AND en) — without `language` the
 *  first (de) variant always won, so English audiobooks got a
 *  "Kapitel: …" announcement and language=German at the sidecar. */
export function findVoice(id: string, language?: string): Voice | undefined {
  const matches = allVoices(true).filter((v) => v.id === id);
  if (matches.length === 0) return undefined;
  if (language) {
    const langMatch = matches.find((v) => v.language === language);
    if (langMatch) return langMatch;
  }
  return matches[0];
}
