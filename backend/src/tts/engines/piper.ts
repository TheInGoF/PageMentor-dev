/**
 * Piper-Engine. Primitives (Binary-Spawn, WAV→MP3) leben in tts/piper.ts —
 * hier nur die Katalog-Erzeugung mit kuratierten Labels und der Dispatcher-
 * konforme Wrapper um `synthesizeTextToWav` + `wavToMp3`.
 */

import { mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isPiperAvailable,
  listPiperVoices,
  synthesizePiperPreview,
  synthesizeTextToWav,
  wavToMp3,
  SPEAKER_SEPARATOR,
} from "../piper";
import type {
  TtsEngine,
  Voice,
  SynthesizeParams,
  SynthesizeResult,
  PreviewParams,
} from "./base";

interface MetaEntry {
  label: string;
  gender: "female" | "male";
  locale: string;
  note?: string;
  flagship?: boolean;
}

const META: Record<string, MetaEntry> = {
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
  "de_DE-eva_k-x_low": { label: "Eva (DE, schnell)", gender: "female", locale: "de-DE" },
  "de_DE-kerstin-low": { label: "Kerstin (DE)", gender: "female", locale: "de-DE" },
  "de_DE-karlsson-low": { label: "Karlsson (DE)", gender: "male", locale: "de-DE" },
  "en_US-lessac-high": {
    label: "Lessac (US, female)",
    gender: "female",
    locale: "en-US",
    note: "LibriVox-trained high-quality audiobook voice.",
  },
  "en_US-amy-medium": { label: "Amy (US, female)", gender: "female", locale: "en-US" },
  "en_US-ryan-high": {
    label: "Ryan (US, male)",
    gender: "male",
    locale: "en-US",
    note: "High-quality male audiobook voice.",
  },
  "en_GB-alba-medium": { label: "Alba (UK, female)", gender: "female", locale: "en-GB" },
  "fr_FR-siwis-medium": { label: "Siwis (FR)", gender: "female", locale: "fr-FR" },
  "es_ES-sharvard-medium": { label: "Sharvard (ES)", gender: "female", locale: "es-ES" },
  "it_IT-riccardo-x_low": { label: "Riccardo (IT)", gender: "male", locale: "it-IT" },
  "nl_NL-mls-medium": { label: "Dutch (NL)", gender: "male", locale: "nl-NL" },
  "pl_PL-mls_6892-low": { label: "Polish (PL)", gender: "male", locale: "pl-PL" },
  "pt_PT-tugao-medium": { label: "Tugao (PT)", gender: "male", locale: "pt-PT" },
  "ru_RU-irina-medium": { label: "Irina (RU)", gender: "female", locale: "ru-RU" },
  "uk_UA-ukrainian_tts-medium": { label: "Ukrainian (UA)", gender: "female", locale: "uk-UA" },
  "zh_CN-huayan-medium": { label: "Huayan (ZH)", gender: "female", locale: "zh-CN" },
  "tr_TR-dfki-medium": { label: "Turkish (TR)", gender: "male", locale: "tr-TR" },
};

function fallbackLabel(voiceId: string, speakerKey: string | undefined): string {
  if (!speakerKey) return voiceId;
  const [model] = voiceId.split(SPEAKER_SEPARATOR);
  return `${model} · ${speakerKey}`;
}

export const piperEngine: TtsEngine = {
  id: "piper",

  isAvailable: isPiperAvailable,

  listVoices(): Voice[] {
    return listPiperVoices().map((p) => {
      const meta = META[p.voiceId];
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
  },

  async synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
    const dir = mkdtempSync(join(tmpdir(), "piper-chunk-"));
    const wav = join(dir, "chunk.wav");
    try {
      await synthesizeTextToWav({
        text: params.text,
        voiceId: params.voice.id,
        outPath: wav,
      });
      await wavToMp3(wav, params.outPath);
      const bytes = statSync(params.outPath).size;
      if (bytes === 0) {
        throw new Error(`Piper produced empty audio for voice=${params.voice.id}`);
      }
      return { path: params.outPath, bytes };
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  },

  async preview(params: PreviewParams): Promise<Buffer> {
    return synthesizePiperPreview({ voiceId: params.voice.id, text: params.text });
  },
};

/** Wählt eine Piper-Flagship-Stimme der gegebenen Sprache — wird als
 *  Fallback genutzt, wenn Edge keine Antwort liefert. */
export function piperFallbackVoice(language: string): Voice | undefined {
  const voices = piperEngine.listVoices();
  return (
    voices.find((v) => v.language === language && v.flagship) ??
    voices.find((v) => v.language === language)
  );
}
