// Intro-Text für die Sprachausgabe: Gemma-Fassung (gecacht mit Stempel), ohne Gemma der ausgeschriebene Rohtext
import { db } from "../../db";
import { preprocessIntroForAudio } from "../audioPreprocess";
import { expandAbbreviations } from "../abbreviations";

export async function introTtsText(docId: string, model?: string): Promise<string | null> {
  const doc = db().prepare("SELECT audio_intro_text, language FROM documents WHERE id = ?").get(docId) as
    | { audio_intro_text: string | null; language: string }
    | undefined;
  if (!doc?.audio_intro_text?.trim()) return null;
  // Der Vorlauf nimmt die gespeicherte Fassung, solange ihr Stempel passt
  try {
    return (await preprocessIntroForAudio({ docId, model })).text;
  } catch (err) {
    // Ohne Gemma: Rohtext, Namen evtl. falsch ausgesprochen
    console.warn(`[tts] intro preprocess failed, falling back to raw text:`, err instanceof Error ? err.message : err);
    return expandAbbreviations(doc.audio_intro_text, doc.language);
  }
}
