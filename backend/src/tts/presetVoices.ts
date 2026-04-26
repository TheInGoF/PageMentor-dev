/**
 * Preset voices from Qwen3-TTS-12Hz-1.7B-CustomVoice.
 *
 * Nine voices anchored in the model — they don't drift between chunks
 * (the weak spot of voice-clone-from-reference in the base model).
 * The language claim of each voice is its native language; the model
 * still renders in the target language passed by the sidecar via the
 * `language` parameter. For DE content the official model card
 * recommends the EN speakers `Ryan` / `Aiden`.
 *
 * Voice-ID convention: `preset:<Speaker>` — the prefix signals the
 * qwen engine to take the CustomVoice path (instead of `custom:<uuid>`
 * for reference uploads).
 */

import type { Voice } from "./engines/base";

export const PRESET_PREFIX = "preset:";

/** Which presets show up in the DE voice list?
 *  The official recommendation for German content is Ryan/Aiden; the
 *  ZH/JP/KR voices we allow for experimentation but mark them as
 *  non-flagship. */
interface PresetSpec {
  speaker: string;
  nativeLang: "zh" | "en" | "ja" | "ko";
  gender: "male" | "female";
  label: string;
  /** Short character hint for the voice picker. */
  flavor: string;
  /** For which target languages do we primarily show the voice in the picker? */
  showFor: Array<"de" | "en">;
  /** Whether the voice is a default candidate for a specific language. */
  flagshipFor?: "de" | "en";
}

const PRESETS: PresetSpec[] = [
  {
    speaker: "Ryan",
    nativeLang: "en",
    gender: "male",
    label: "Ryan",
    flavor: "dynamic, clear audiobook narrator",
    showFor: ["de", "en"],
    flagshipFor: "de",
  },
  {
    speaker: "Aiden",
    nativeLang: "en",
    gender: "male",
    label: "Aiden",
    flavor: "sunny, mid-range US tone",
    showFor: ["de", "en"],
    flagshipFor: "en",
  },
  {
    speaker: "Vivian",
    nativeLang: "zh",
    gender: "female",
    label: "Vivian",
    flavor: "bright young woman (ZH native voice)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Serena",
    nativeLang: "zh",
    gender: "female",
    label: "Serena",
    flavor: "warm, gentle (ZH native voice)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Uncle_Fu",
    nativeLang: "zh",
    gender: "male",
    label: "Uncle Fu",
    flavor: "mature, mild man (ZH native voice)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Dylan",
    nativeLang: "zh",
    gender: "male",
    label: "Dylan",
    flavor: "youthful, Beijing (ZH native voice)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Eric",
    nativeLang: "zh",
    gender: "male",
    label: "Eric",
    flavor: "lively, Sichuan (ZH native voice)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Ono_Anna",
    nativeLang: "ja",
    gender: "female",
    label: "Ono Anna",
    flavor: "playful (JP native voice)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Sohee",
    nativeLang: "ko",
    gender: "female",
    label: "Sohee",
    flavor: "warm, emotional (KR native voice)",
    showFor: ["de", "en"],
  },
];

function toVoice(spec: PresetSpec, targetLang: "de" | "en"): Voice {
  const locale = targetLang === "de" ? "de-DE" : "en-US";
  return {
    id: `${PRESET_PREFIX}${spec.speaker}`,
    label: `${spec.label} · Preset`,
    language: targetLang,
    locale,
    gender: spec.gender,
    engine: "qwen",
    flagship: spec.flagshipFor === targetLang,
    note: `Qwen3-TTS CustomVoice · ${spec.flavor}`,
    msPerChar: null,
  };
}

/** Voice objects for all presets in all target languages. Per language
 *  each preset voice appears once — the ID is the same (language is
 *  in the request, not in the voice ID), so consumers dedupe the list
 *  by ID when needed. */
export function listPresetVoices(): Voice[] {
  const out: Voice[] = [];
  for (const spec of PRESETS) {
    for (const lang of spec.showFor) {
      out.push(toVoice(spec, lang));
    }
  }
  return out;
}

/** Returns the speaker name for a preset voice ID, or null if it's
 *  not a preset ID. */
export function speakerForPresetId(voiceId: string): string | null {
  if (!voiceId.startsWith(PRESET_PREFIX)) return null;
  const speaker = voiceId.slice(PRESET_PREFIX.length);
  return PRESETS.some((p) => p.speaker === speaker) ? speaker : null;
}
