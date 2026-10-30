// Intro-Text für die Sprachausgabe: phonetische Fassung aus dem Cache, sonst Gemma, sonst Rohtext
import { db } from "../../db";
import { preprocessIntroForAudio } from "../audioPreprocess";

export async function introTtsText(docId: string, model?: string): Promise<string | null> {
  const doc = db().prepare("SELECT audio_intro_text, audio_intro_text_tts FROM documents WHERE id = ?").get(docId) as
    | { audio_intro_text: string | null; audio_intro_text_tts: string | null }
    | undefined;
  if (!doc?.audio_intro_text?.trim()) return null;
  if (doc.audio_intro_text_tts?.trim()) return doc.audio_intro_text_tts;
  try {
    return (await preprocessIntroForAudio({ docId, model })).text;
  } catch (err) {
    // Ohne Gemma: Rohtext, Namen evtl. falsch ausgesprochen
    console.warn(`[tts] intro preprocess failed, falling back to raw text:`, err instanceof Error ? err.message : err);
    return doc.audio_intro_text;
  }
}
