// Hörbuch-Intro: Modell- und Markennamen phonetisch schreiben
// "Qwen3-TTS" → "Kwenn drei T T S", Cache in audio_intro_text_tts
// Eigener kurzer Prompt: der Kapitel-Prompt kippt Gemma in Kommentar-Modus

import { db } from "../../db";
import { generate } from "../llm";
import { withGemmaLock } from "../gemmaLock";
import { INTRO_SYSTEM_DE, INTRO_SYSTEM_EN } from "./prompts";
import { runJob } from "../../log/jobs";

export interface IntroPreprocessResult {
  text: string;
  model: string;
  cached: boolean;
}

// Wie preprocessChapterForAudio, aber ohne Teilstücke und Zahlwort-Prüfung
async function preprocessIntroForAudioImpl(params: {
  docId: string;
  model?: string;
  force?: boolean;
}): Promise<IntroPreprocessResult> {
  const d = db();
  const row = d
    .prepare(
      "SELECT id, language, audio_intro_text, audio_intro_text_tts, audio_intro_text_tts_model FROM documents WHERE id = ?"
    )
    .get(params.docId) as
    | {
        id: string;
        language: string;
        audio_intro_text: string | null;
        audio_intro_text_tts: string | null;
        audio_intro_text_tts_model: string | null;
      }
    | undefined;
  if (!row) throw new Error(`Document ${params.docId} not found`);
  if (!row.audio_intro_text || row.audio_intro_text.trim().length === 0) {
    throw new Error("Intro text is empty");
  }

  if (
    !params.force &&
    row.audio_intro_text_tts &&
    row.audio_intro_text_tts.trim().length > 0
  ) {
    return {
      text: row.audio_intro_text_tts,
      model: row.audio_intro_text_tts_model ?? "cached",
      cached: true,
    };
  }

  const introLabel = `intro ${params.docId.slice(0, 8)}`;
  return withGemmaLock(introLabel, async () => {
    const tStart = Date.now();
    const sourceText = row.audio_intro_text!;
    console.log(
      `[audio-preprocess] ${introLabel} START (${sourceText.length} chars source)`
    );

    const system =
      row.language === "de" ? INTRO_SYSTEM_DE : INTRO_SYSTEM_EN;

    const ollamaOptions = {
      // Reine Ersetzung: deterministisch
      temperature: 0.0,
      top_p: 0.9,
      num_ctx: 4096,
      num_predict: 1024,
    };

    const result = await generate({
      prompt: sourceText,
      system,
      model: params.model,
      options: ollamaOptions,
    });

    const piece = result.response?.trim() ?? "";
    if (piece.length < 5) {
      throw new Error(
        `Intro preprocessor returned only ${piece.length} chars ` +
          `(model=${result.model}, reason=${result.doneReason ?? "?"}).`
      );
    }

    d.prepare(
      "UPDATE documents SET audio_intro_text_tts = ?, audio_intro_text_tts_model = ? WHERE id = ?"
    ).run(piece, result.model, params.docId);

    console.log(
      `[audio-preprocess] ${introLabel} DONE in ${((Date.now() - tStart) / 1000).toFixed(1)}s ` +
        `(${sourceText.length} -> ${piece.length} chars, model=${result.model})`
    );

    return { text: piece, model: result.model, cached: false };
  });
}

// Nach Bearbeiten des Intro-Texts: nächster Lauf fragt Gemma neu
export function clearAudioIntroTtsCache(docId: string): void {
  db()
    .prepare(
      "UPDATE documents SET audio_intro_text_tts = NULL, audio_intro_text_tts_model = NULL WHERE id = ?"
    )
    .run(docId);
}

export function preprocessIntroForAudio(...args: Parameters<typeof preprocessIntroForAudioImpl>): ReturnType<typeof preprocessIntroForAudioImpl> {
  return runJob("intro-preprocess", "audiobook", { docId: args[0].docId }, () => preprocessIntroForAudioImpl(...args));
}
