// Versionsstempel für Hörbuch-Teile: Fingerabdruck aus allem, was das Ergebnis bestimmt.
// Gemma-Fassung: Anweisung samt Hinweisen und Version des Vorlaufs. Audio: gesprochener Text,
// Stimme, Tempo, Aussprache-Liste und Version der Sprachausgabe. Die Stempel werden nie gesprochen.
// Version hochzählen, wenn sich Vorlauf oder Sprachausgabe im Code ändern.
import { createHash } from "crypto";
import { getPrompt } from "./prompts";
import { cleanupHints } from "./promptHints";
import { applyPronunciation } from "./pronunciation";

// gemma 3: Buchstabennamen für Abkürzungen ("Teh Teh Ess") im Vorlauf
export const PIPELINE_VERSION = { gemma: 3, tts: 2 };

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// variant: weitere Einflüsse auf die Anweisung, z. B. die zweite Sprache des Buchs
export function gemmaStamp(kind: "chapter" | "intro", language: string, variant = ""): string {
  const de = language === "de";
  const prompt = getPrompt(kind === "chapter" ? (de ? "audio-chapter.de" : "audio-chapter.en") : de ? "audio-intro.de" : "audio-intro.en");
  const hints = kind === "chapter" ? cleanupHints(de ? "de" : "en", "audio") : "";
  // Geprüfte Aussprache-Beispiele zählen bewusst nicht: sie helfen bei neuen Wörtern, ein neuer Haken
  // soll nicht alle Kapitel neu aufbereiten. Was gesprochen wird, sichert der Audio-Stempel
  return hash(`${PIPELINE_VERSION.gemma}|${kind}|${prompt}|${hints}|${variant}`);
}

// Stempel aus dem tatsächlich gesprochenen Text: bei deutschen Stimmen nach der Aussprache-Liste.
// So erneuert eine geänderte Liste nur Kapitel, in denen das Wort vorkommt
export function ttsStamp(text: string, voiceId: string, rate: string, locale: string): string {
  const spoken = locale.startsWith("de") ? applyPronunciation(text) : text;
  // Engine-eigene Version: Änderungen an einer Engine erneuern nur deren Kapitel
  const engines = voiceId.split("+").map((v) => `${v.split(":")[0]}${ENGINE_VERSION[v.split(":")[0]] ?? 0}`).join(",");
  return hash(`${PIPELINE_VERSION.tts}|${engines}|${voiceId}|${rate}|${spoken}`);
}

// f5 1: kürzere Abschnitte und Dauer mit Reserve gegen verschluckte Anfänge und Enden
const ENGINE_VERSION: Record<string, number> = { f5: 1 };
