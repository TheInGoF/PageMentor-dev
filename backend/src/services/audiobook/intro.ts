// Intro-Text für die Sprachausgabe: Gemma-Fassung (gecacht mit Stempel), ohne Gemma der ausgeschriebene Rohtext.
// Gleich für Original-Hörbuch und Lernhörbücher
import { preprocessIntroForAudio } from "../audioPreprocess";
import { expandAbbreviations } from "../abbreviations";
import { getIntro, type IntroVariant } from "./introStore";

export async function introTtsText(docId: string, model?: string, variant: IntroVariant = "original"): Promise<string | null> {
  const intro = getIntro(docId, variant);
  if (!intro?.text?.trim()) return null;
  // Der Vorlauf nimmt die gespeicherte Fassung, solange ihr Stempel passt
  try {
    return (await preprocessIntroForAudio({ docId, model, variant })).text;
  } catch (err) {
    // Ohne Gemma: Rohtext, Namen evtl. falsch ausgesprochen
    console.warn(`[tts] intro preprocess failed, falling back to raw text:`, err instanceof Error ? err.message : err);
    return expandAbbreviations(intro.text, intro.language);
  }
}
