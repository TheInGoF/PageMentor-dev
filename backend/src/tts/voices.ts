/**
 * Voice-Katalog — Piper (lokal, ONNX) als einzige Engine.
 *
 * Edge Read-Aloud wurde entfernt: Microsofts Websocket-API liefert
 * unzuverlässig leere Antworten, sobald ihr trusted-client-token
 * abläuft. Piper läuft offline, braucht keinen externen Dienst und
 * ist die zweite Hälfte der „ollama + piper"-Pipeline.
 *
 * Welche Modelle verfügbar sind, entscheidet das Docker-Build-Arg
 * `PIPER_LANGS`; gescannt wird PM_PIPER_DIR beim Start. Multi-Speaker-
 * Modelle werden pro Sprecher-Key in je einen eigenen Voice-Eintrag
 * aufgefaltet — so kann der UI-Picker z. B. 8 Emotions-Varianten von
 * `thorsten_emotional-medium` einzeln anbieten.
 */

import { listPiperVoices, SPEAKER_SEPARATOR } from "./piper";

export type TtsEngine = "piper";

export interface Voice {
  id: string;
  label: string;
  language: string;        // "de", "en"
  locale: string;          // "de-DE", "en-US"
  gender: "female" | "male";
  engine: TtsEngine;
  flagship?: boolean;
  note?: string;
}

interface MetaEntry {
  label: string;
  gender: "female" | "male";
  locale: string;
  note?: string;
  flagship?: boolean;
}

// Metadaten-Overrides. Key ist die vollständige Voice-ID (inkl. ggf.
// Speaker-Suffix `.xxx`). Unbekannte Voices bekommen einen Label-Fallback.
const PIPER_META: Record<string, MetaEntry> = {
  // -------- Deutsch ----------------------------------------------------
  "de_DE-thorsten-high": {
    label: "Thorsten (DE, neutral)",
    gender: "male",
    locale: "de-DE",
    note: "Audiobuch-trainierte Standardstimme.",
    flagship: true,
  },
  "de_DE-thorsten_emotional-medium.neutral": {
    label: "Thorsten (DE, ausgeglichen)",
    gender: "male",
    locale: "de-DE",
    note: "Thorsten-Stimme, warmer + lebendiger als high.",
    flagship: true,
  },
  "de_DE-thorsten_emotional-medium.amused": {
    label: "Thorsten (DE, freundlich)",
    gender: "male",
    locale: "de-DE",
  },
  "de_DE-thorsten_emotional-medium.surprised": {
    label: "Thorsten (DE, lebhaft)",
    gender: "male",
    locale: "de-DE",
  },
  "de_DE-thorsten_emotional-medium.sleepy": {
    label: "Thorsten (DE, ruhig)",
    gender: "male",
    locale: "de-DE",
  },
  "de_DE-thorsten_emotional-medium.whisper": {
    label: "Thorsten (DE, flüsternd)",
    gender: "male",
    locale: "de-DE",
  },
  "de_DE-thorsten_emotional-medium.angry": {
    label: "Thorsten (DE, bestimmt)",
    gender: "male",
    locale: "de-DE",
  },
  // Disgusted/drunk bewusst ausgelassen — für Studientexte ungeeignet.
  // Sie landen trotzdem per Fallback-Label im Catalog, solange das
  // Modell sie in speaker_id_map meldet.

  "de_DE-pavoque-low": {
    label: "Pavoque (DE, männlich)",
    gender: "male",
    locale: "de-DE",
    note: "Alternative zu Thorsten, etwas dunklerer Klang.",
  },
  "de_DE-ramona-low": {
    label: "Ramona (DE, weiblich)",
    gender: "female",
    locale: "de-DE",
    note: "Deutsche Sprecherin, kompaktes Modell.",
  },
  "de_DE-eva_k-x_low": {
    label: "Eva (DE, schnell)",
    gender: "female",
    locale: "de-DE",
  },
  "de_DE-kerstin-low": {
    label: "Kerstin (DE)",
    gender: "female",
    locale: "de-DE",
  },
  "de_DE-karlsson-low": {
    label: "Karlsson (DE)",
    gender: "male",
    locale: "de-DE",
  },

  // -------- English ----------------------------------------------------
  "en_US-lessac-high": {
    label: "Lessac (US, female)",
    gender: "female",
    locale: "en-US",
    note: "LibriVox-trained high-quality audiobook voice.",
    flagship: true,
  },
  "en_US-amy-medium": {
    label: "Amy (US, female)",
    gender: "female",
    locale: "en-US",
  },
  "en_US-ryan-high": {
    label: "Ryan (US, male)",
    gender: "male",
    locale: "en-US",
    note: "High-quality male audiobook voice.",
  },
  "en_GB-alba-medium": {
    label: "Alba (UK, female)",
    gender: "female",
    locale: "en-GB",
  },

  // -------- Weitere Sprachen (Einzelstimmen) --------------------------
  "fr_FR-siwis-medium": { label: "Siwis (FR)", gender: "female", locale: "fr-FR" },
  "es_ES-sharvard-medium": { label: "Sharvard (ES)", gender: "female", locale: "es-ES" },
  "it_IT-riccardo-x_low": { label: "Riccardo (IT)", gender: "male", locale: "it-IT" },
  "nl_NL-mls-medium": { label: "Dutch (NL)", gender: "male", locale: "nl-NL" },
  "pl_PL-mls_6892-low": { label: "Polish (PL)", gender: "male", locale: "pl-PL" },
  "pt_PT-tugao-medium": { label: "Tugao (PT)", gender: "male", locale: "pt-PT" },
  "ru_RU-irina-medium": { label: "Irina (RU)", gender: "female", locale: "ru-RU" },
  "uk_UA-ukrainian_tts-medium": {
    label: "Ukrainian (UA)",
    gender: "female",
    locale: "uk-UA",
  },
  "zh_CN-huayan-medium": { label: "Huayan (ZH)", gender: "female", locale: "zh-CN" },
  "tr_TR-dfki-medium": { label: "Turkish (TR)", gender: "male", locale: "tr-TR" },
};

/** Fallback-Label für Voices, die nicht in PIPER_META stehen. Für
 *  Multi-Speaker-Modelle ohne Override zeigt das Label den Speaker-Key. */
function fallbackLabel(voiceId: string, speakerKey: string | undefined): string {
  if (!speakerKey) return voiceId;
  const [model] = voiceId.split(SPEAKER_SEPARATOR);
  return `${model} · ${speakerKey}`;
}

export function allVoices(): Voice[] {
  return listPiperVoices().map((p) => {
    const meta = PIPER_META[p.voiceId];
    const locale = meta?.locale ?? p.locale.replace("_", "-");
    return {
      id: p.voiceId,
      label: meta?.label ?? fallbackLabel(p.voiceId, p.speakerKey),
      language: p.language,
      locale,
      gender: meta?.gender ?? "female",
      engine: "piper",
      flagship: meta?.flagship,
      note: meta?.note,
    };
  });
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
