// Versionsstempel für Hörbuch-Teile: Fingerabdruck aus allem, was das Ergebnis bestimmt.
// Gemma-Fassung: Anweisung samt Hinweisen und Version des Vorlaufs. Audio: gesprochener Text,
// Stimme, Tempo, Aussprache-Liste und Version der Sprachausgabe. Die Stempel werden nie gesprochen.
// Version hochzählen, wenn sich Vorlauf oder Sprachausgabe im Code ändern.
import { createHash } from "crypto";
import { getPrompt } from "./prompts";
import { cleanupHints } from "./promptHints";
import { pronunciationList } from "./pronunciation";

export const PIPELINE_VERSION = { gemma: 2, tts: 2 };

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// variant: weitere Einflüsse auf die Anweisung, z. B. die zweite Sprache des Buchs
export function gemmaStamp(kind: "chapter" | "intro", language: string, variant = ""): string {
  const de = language === "de";
  const prompt = getPrompt(kind === "chapter" ? (de ? "audio-chapter.de" : "audio-chapter.en") : de ? "audio-intro.de" : "audio-intro.en");
  const hints = kind === "chapter" ? cleanupHints(de ? "de" : "en", "audio") : "";
  return hash(`${PIPELINE_VERSION.gemma}|${kind}|${prompt}|${hints}|${variant}`);
}

// Aussprache-Liste zählt nur bei deutschen Stimmen, dort wird sie angewendet
export function ttsStamp(text: string, voiceId: string, rate: string, locale: string): string {
  const pron = locale.startsWith("de") ? JSON.stringify(pronunciationList().entries) : "";
  return hash(`${PIPELINE_VERSION.tts}|${voiceId}|${rate}|${pron}|${text}`);
}
