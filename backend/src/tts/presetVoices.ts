/**
 * Preset-Voices aus Qwen3-TTS-12Hz-1.7B-CustomVoice.
 *
 * Neun im Modell verankerte Stimmen — driften nicht zwischen Chunks
 * (der Schwachpunkt von Voice-Clone-aus-Referenz im Base-Modell).
 * Der Sprachen-Claim der Stimmen ist ihre Muttersprache; das Modell
 * rendert aber in die Zielsprache, die der Sidecar per `language`-
 * Parameter übergibt. Für DE-Content empfiehlt die offizielle
 * Model-Card die EN-Speaker `Ryan` / `Aiden`.
 *
 * Voice-ID-Konvention: `preset:<Speaker>` — der Präfix signalisiert
 * der qwen-Engine den CustomVoice-Pfad (anstelle von `custom:<uuid>`
 * für Referenz-Uploads).
 */

import type { Voice } from "./engines/base";

export const PRESET_PREFIX = "preset:";

/** Welche Presets tauchen in der DE-Voice-Liste auf?
 *  Die offizielle Empfehlung für deutsche Inhalte ist Ryan/Aiden; die
 *  ZH/JP/KR-Stimmen erlauben wir zusätzlich für Experimente, markieren
 *  sie aber als Nicht-Flagship. */
interface PresetSpec {
  speaker: string;
  nativeLang: "zh" | "en" | "ja" | "ko";
  gender: "male" | "female";
  label: string;
  /** Kurzer Charakter-Hinweis für den Voice-Picker. */
  flavor: string;
  /** Für welche Zielsprachen zeigen wir die Voice im Picker primär an? */
  showFor: Array<"de" | "en">;
  /** Ob die Voice als Default-Kandidat für eine bestimmte Sprache gilt. */
  flagshipFor?: "de" | "en";
}

const PRESETS: PresetSpec[] = [
  {
    speaker: "Ryan",
    nativeLang: "en",
    gender: "male",
    label: "Ryan",
    flavor: "dynamisch, klarer Hörbuch-Erzähler",
    showFor: ["de", "en"],
    flagshipFor: "de",
  },
  {
    speaker: "Aiden",
    nativeLang: "en",
    gender: "male",
    label: "Aiden",
    flavor: "sonnig, mittlere US-Tonlage",
    showFor: ["de", "en"],
    flagshipFor: "en",
  },
  {
    speaker: "Vivian",
    nativeLang: "zh",
    gender: "female",
    label: "Vivian",
    flavor: "helle junge Frau (ZH-Stammstimme)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Serena",
    nativeLang: "zh",
    gender: "female",
    label: "Serena",
    flavor: "warm, sanft (ZH-Stammstimme)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Uncle_Fu",
    nativeLang: "zh",
    gender: "male",
    label: "Uncle Fu",
    flavor: "reifer, milder Mann (ZH-Stammstimme)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Dylan",
    nativeLang: "zh",
    gender: "male",
    label: "Dylan",
    flavor: "jugendlich, Beijing (ZH-Stammstimme)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Eric",
    nativeLang: "zh",
    gender: "male",
    label: "Eric",
    flavor: "lebhaft, Sichuan (ZH-Stammstimme)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Ono_Anna",
    nativeLang: "ja",
    gender: "female",
    label: "Ono Anna",
    flavor: "verspielt (JP-Stammstimme)",
    showFor: ["de", "en"],
  },
  {
    speaker: "Sohee",
    nativeLang: "ko",
    gender: "female",
    label: "Sohee",
    flavor: "warm, emotional (KR-Stammstimme)",
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

/** Voice-Objekte aller Presets in allen Ziel-Sprachen. Pro Sprache
 *  erscheint jede Preset-Stimme einmal — die ID ist dieselbe (die
 *  Sprache steckt im Request, nicht in der Voice-ID), darum deduplizieren
 *  Consumer die Liste bei Bedarf über die ID. */
export function listPresetVoices(): Voice[] {
  const out: Voice[] = [];
  for (const spec of PRESETS) {
    for (const lang of spec.showFor) {
      out.push(toVoice(spec, lang));
    }
  }
  return out;
}

/** Liefert den Speaker-Namen für eine Preset-Voice-ID, oder null wenn
 *  es keine Preset-ID ist. */
export function speakerForPresetId(voiceId: string): string | null {
  if (!voiceId.startsWith(PRESET_PREFIX)) return null;
  const speaker = voiceId.slice(PRESET_PREFIX.length);
  return PRESETS.some((p) => p.speaker === speaker) ? speaker : null;
}
