/**
 * Voice-Katalog über alle Engines hinter dem pm-gpu-arbiter.
 *
 * Kokoro ist immer da (Martin, Kerstin), Qwen3-TTS, F5 und TADA sind
 * optional. Standard je Sprache: Einstellungen, sonst F5 vor Kokoro vor Qwen. Eigene Stimmen sind User-Uploads aus SQLite.
 */

import { qwenEngine } from "./engines/qwen";
import { f5Engine, kokoroEngine, tadaEngine } from "./engines/extra/engine";
import type { EngineId, TtsEngine, Voice } from "./engines/base";
import { hiddenPresetIds } from "../services/audioVoiceVisibility";
import { getLlmConfig, setLlmConfig } from "../services/llmConfig";

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

export interface VoicePrefs {
  gender: "female" | "male" | "";
  byLang: Record<string, string>;
}

export function voicePrefs(): VoicePrefs {
  const cfg = getLlmConfig();
  let byLang: Record<string, string> = {};
  try {
    byLang = JSON.parse(cfg.voiceDefaults || "{}") as Record<string, string>;
  } catch {
    /* kaputt: leer */
  }
  const g = cfg.voiceGender;
  return { gender: g === "female" || g === "male" ? g : "", byLang };
}

export function setVoicePrefs(p: Partial<VoicePrefs>): VoicePrefs {
  const cur = voicePrefs();
  const byLang = Object.fromEntries(Object.entries({ ...cur.byLang, ...(p.byLang ?? {}) }).filter(([, v]) => v));
  setLlmConfig({ voiceGender: p.gender ?? cur.gender, voiceDefaults: JSON.stringify(byLang) });
  return voicePrefs();
}

// F5 klingt am natürlichsten, Kokoro ist schnell, Qwen langsam, TADA experimentell
const ENGINE_RANK: EngineId[] = ["f5", "kokoro", "qwen", "tada"];

// Beste verfügbare Stimme einer Sprache, auf Wunsch mit passender Stimmlage
export function pickVoice(language: string, gender: VoicePrefs["gender"] = ""): Voice | undefined {
  const rank = (v: Voice) =>
    (gender && v.gender !== gender ? 100 : 0) + ENGINE_RANK.indexOf(v.engine) * 10 + (v.flagship ? 0 : 1);
  return allVoices()
    .filter((v) => v.language === language)
    .sort((a, b) => rank(a) - rank(b))[0];
}

// Standardstimme einer Sprache: Wahl in den Einstellungen, sonst die beste zur Stimmlage
export function defaultVoiceFor(language: string): string {
  const prefs = voicePrefs();
  const chosen = prefs.byLang[language];
  if (chosen && findVoice(chosen, language)?.language === language) return chosen;
  return pickVoice(language, prefs.gender)?.id ?? "";
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
