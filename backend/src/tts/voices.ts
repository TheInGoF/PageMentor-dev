/**
 * Voice-Katalog für zwei Engines:
 *
 *   - `edge`  — Microsofts Neural-Stimmen via Edge Read-Aloud-Websocket.
 *               Beste Prosodie, aber angewiesen auf Azure-Erreichbarkeit.
 *   - `piper` — Lokale ONNX-Modelle (offline). Wird aus PM_PIPER_DIR
 *               beim Start gescannt; welche Sprachen verfügbar sind,
 *               entscheidet der Build-Arg `PIPER_LANGS`.
 *
 * Rate/Pitch-Defaults sind bewusst auf "natürlich" eingestellt. Edge
 * unterstützt SSML-Rate; Piper wird über Satzsegmentierung gesteuert.
 */

import { listPiperVoices } from "./piper";

export type TtsEngine = "edge" | "piper";

export interface Voice {
  id: string;
  label: string;
  language: string;        // "de", "en"
  locale: string;          // "de-DE", "en-US" — Edge-Format
  gender: "female" | "male";
  engine: TtsEngine;
  flagship?: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Edge Neural voices
// ---------------------------------------------------------------------------
const EDGE_VOICES: Voice[] = [
  {
    id: "de-DE-SeraphinaMultilingualNeural",
    label: "Seraphina (DE, Multilingual)",
    language: "de",
    locale: "de-DE",
    gender: "female",
    engine: "edge",
    flagship: true,
    note: "Warme, klare Vorlesestimme — Studio-Qualität.",
  },
  {
    id: "de-DE-FlorianMultilingualNeural",
    label: "Florian (DE, Multilingual)",
    language: "de",
    locale: "de-DE",
    gender: "male",
    engine: "edge",
    flagship: true,
    note: "Ruhige, männliche Vorlesestimme mit exzellenter Prosodie.",
  },
  {
    id: "de-DE-KatjaNeural",
    label: "Katja (DE)",
    language: "de",
    locale: "de-DE",
    gender: "female",
    engine: "edge",
  },
  {
    id: "de-DE-ConradNeural",
    label: "Conrad (DE)",
    language: "de",
    locale: "de-DE",
    gender: "male",
    engine: "edge",
  },
  {
    id: "de-AT-IngridNeural",
    label: "Ingrid (AT)",
    language: "de",
    locale: "de-AT",
    gender: "female",
    engine: "edge",
  },
  {
    id: "de-CH-LeniNeural",
    label: "Leni (CH)",
    language: "de",
    locale: "de-CH",
    gender: "female",
    engine: "edge",
  },

  {
    id: "en-US-AvaMultilingualNeural",
    label: "Ava (US, Multilingual)",
    language: "en",
    locale: "en-US",
    gender: "female",
    engine: "edge",
    flagship: true,
    note: "Microsoft flagship voice — natural, expressive.",
  },
  {
    id: "en-US-AndrewMultilingualNeural",
    label: "Andrew (US, Multilingual)",
    language: "en",
    locale: "en-US",
    gender: "male",
    engine: "edge",
    flagship: true,
  },
  {
    id: "en-US-EmmaMultilingualNeural",
    label: "Emma (US, Multilingual)",
    language: "en",
    locale: "en-US",
    gender: "female",
    engine: "edge",
  },
  {
    id: "en-US-BrianMultilingualNeural",
    label: "Brian (US, Multilingual)",
    language: "en",
    locale: "en-US",
    gender: "male",
    engine: "edge",
  },
  {
    id: "en-GB-SoniaNeural",
    label: "Sonia (UK)",
    language: "en",
    locale: "en-GB",
    gender: "female",
    engine: "edge",
  },
  {
    id: "en-GB-RyanNeural",
    label: "Ryan (UK)",
    language: "en",
    locale: "en-GB",
    gender: "male",
    engine: "edge",
  },
];

// ---------------------------------------------------------------------------
// Metadata overrides for known Piper voices (label, gender, locale).
// Unbekannte Voice-IDs bekommen einen generischen Label-Fallback.
// ---------------------------------------------------------------------------
const PIPER_META: Record<
  string,
  { label: string; gender: "female" | "male"; locale: string; note?: string; flagship?: boolean }
> = {
  "de_DE-thorsten-high": {
    label: "Thorsten (DE, lokal)",
    gender: "male",
    locale: "de-DE",
    note: "Audiobuch-trainierte, natürliche Hörbuchstimme.",
    flagship: true,
  },
  "de_DE-eva_k-x_low": {
    label: "Eva (DE, lokal, schnell)",
    gender: "female",
    locale: "de-DE",
  },
  "de_DE-kerstin-low": {
    label: "Kerstin (DE, lokal)",
    gender: "female",
    locale: "de-DE",
  },
  "en_US-lessac-high": {
    label: "Lessac (US, local)",
    gender: "female",
    locale: "en-US",
    note: "LibriVox-trained high-quality audiobook voice.",
    flagship: true,
  },
  "en_US-amy-medium": {
    label: "Amy (US, local)",
    gender: "female",
    locale: "en-US",
  },
  "fr_FR-siwis-medium": { label: "Siwis (FR, local)", gender: "female", locale: "fr-FR" },
  "es_ES-sharvard-medium": { label: "Sharvard (ES, local)", gender: "female", locale: "es-ES" },
  "it_IT-riccardo-x_low": { label: "Riccardo (IT, local)", gender: "male", locale: "it-IT" },
  "nl_NL-mls-medium": { label: "Dutch (NL, local)", gender: "male", locale: "nl-NL" },
  "pl_PL-mls_6892-low": { label: "Polish (PL, local)", gender: "male", locale: "pl-PL" },
  "pt_PT-tugao-medium": { label: "Tugao (PT, local)", gender: "male", locale: "pt-PT" },
  "ru_RU-irina-medium": { label: "Irina (RU, local)", gender: "female", locale: "ru-RU" },
  "uk_UA-ukrainian_tts-medium": {
    label: "Ukrainian (UA, local)",
    gender: "female",
    locale: "uk-UA",
  },
  "zh_CN-huayan-medium": { label: "Huayan (ZH, local)", gender: "female", locale: "zh-CN" },
  "tr_TR-dfki-medium": { label: "Turkish (TR, local)", gender: "male", locale: "tr-TR" },
};

function piperVoices(): Voice[] {
  return listPiperVoices().map((p) => {
    const meta = PIPER_META[p.voiceId];
    const locale = meta?.locale ?? p.locale.replace("_", "-");
    return {
      id: p.voiceId,
      label: meta?.label ?? `${p.voiceId} (local)`,
      language: p.language,
      locale,
      gender: meta?.gender ?? "female",
      engine: "piper",
      flagship: meta?.flagship,
      note: meta?.note,
    };
  });
}

export function allVoices(): Voice[] {
  return [...EDGE_VOICES, ...piperVoices()];
}

export function defaultVoiceFor(language: string): string {
  const voices = allVoices();
  // Prefer a local (Piper) flagship — works offline — over Edge, which has
  // been flaky for us when Azure throttles Microsoft's Edge-WebSocket API.
  const piperFlagship = voices.find(
    (v) => v.engine === "piper" && v.language === language && v.flagship
  );
  if (piperFlagship) return piperFlagship.id;
  const piperAny = voices.find((v) => v.engine === "piper" && v.language === language);
  if (piperAny) return piperAny.id;
  const edgeFlagship = voices.find(
    (v) => v.engine === "edge" && v.language === language && v.flagship
  );
  if (edgeFlagship) return edgeFlagship.id;
  const any = voices.find((v) => v.language === language);
  return any?.id ?? voices[0]?.id ?? "de-DE-SeraphinaMultilingualNeural";
}

export function findVoice(id: string): Voice | undefined {
  return allVoices().find((v) => v.id === id);
}

