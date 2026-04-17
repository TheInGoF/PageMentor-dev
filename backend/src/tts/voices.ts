/**
 * Voice-Katalog — Piper (lokal, ONNX) als einzige Engine.
 *
 * Edge Read-Aloud wurde entfernt: Microsofts Websocket-API liefert
 * unzuverlässig leere Antworten, sobald ihr trusted-client-token
 * abläuft. Piper läuft offline, braucht keinen externen Dienst und
 * ist die zweite Hälfte der „ollama + piper"-Pipeline.
 *
 * Welche Sprachen verfügbar sind, entscheidet das Docker-Build-Arg
 * `PIPER_LANGS`; gescannt wird PM_PIPER_DIR beim Start.
 */

import { listPiperVoices } from "./piper";

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

// Metadaten-Overrides für kuratierte Piper-Stimmen. Unbekannte Voices
// (falls sie manuell in PM_PIPER_DIR gelegt werden) kriegen einen
// generischen Label-Fallback.
const PIPER_META: Record<
  string,
  { label: string; gender: "female" | "male"; locale: string; note?: string; flagship?: boolean }
> = {
  "de_DE-thorsten-high": {
    label: "Thorsten (DE)",
    gender: "male",
    locale: "de-DE",
    note: "Audiobuch-trainierte, natürliche Hörbuchstimme.",
    flagship: true,
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
  "en_US-lessac-high": {
    label: "Lessac (US)",
    gender: "female",
    locale: "en-US",
    note: "LibriVox-trained high-quality audiobook voice.",
    flagship: true,
  },
  "en_US-amy-medium": {
    label: "Amy (US)",
    gender: "female",
    locale: "en-US",
  },
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

export function allVoices(): Voice[] {
  return listPiperVoices().map((p) => {
    const meta = PIPER_META[p.voiceId];
    const locale = meta?.locale ?? p.locale.replace("_", "-");
    return {
      id: p.voiceId,
      label: meta?.label ?? `${p.voiceId}`,
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
