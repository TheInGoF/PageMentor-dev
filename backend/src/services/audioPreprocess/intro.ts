// Hörbuch-Intro: Modell- und Markennamen phonetisch schreiben
// "Qwen3-TTS" → "Kwenn drei T T S", Cache in audio_intro_text_tts
// Eigener kurzer Prompt: der Kapitel-Prompt kippt Gemma in Kommentar-Modus

import { createHash } from "node:crypto";
import { getIntro, setIntroTts, type IntroVariant } from "../audiobook/introStore";
import { generate } from "../llm";
import { withGemmaLock } from "../gemmaLock";
import { introSystemFor } from "./prompts";
import { gemmaStamp } from "../stamps";
import { examplesBlock } from "../pronunciation";
import { expandAbbreviations } from "../abbreviations";
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
  variant?: IntroVariant;
}): Promise<IntroPreprocessResult> {
  const variant = params.variant ?? "original";
  const intro = getIntro(params.docId, variant);
  if (!intro) throw new Error(`Document ${params.docId} not found`);
  const row = { language: intro.language, audio_intro_text: intro.text };
  // Gecacht nur, wenn von Hand bearbeitet oder mit der aktuellen Anweisung entstanden
  // Lernhörbücher: die Vorlage ändert sich mit dem Heft (Einheiten, Autor), darum gehört der Text in den Stempel
  const stamp = variant === "original" ? gemmaStamp("intro", intro.language) : `${gemmaStamp("intro", intro.language)}:${createHash("sha1").update(intro.text ?? "").digest("hex").slice(0, 10)}`;
  const fresh = intro.ttsModel === "manual-edit" || intro.ttsStamp === stamp;
  if (!intro.text || intro.text.trim().length === 0) {
    throw new Error("Intro text is empty");
  }

  if (!params.force && fresh && intro.tts && intro.tts.trim().length > 0) {
    return { text: intro.tts, model: intro.ttsModel ?? "cached", cached: true };
  }

  const introLabel = `intro ${variant === "original" ? "" : `${variant} `}${params.docId.slice(0, 8)}`;
  return withGemmaLock(introLabel, async () => {
    const tStart = Date.now();
    // Deterministischer Pre-Pass wie bei Kapiteln: Titel und Abkürzungen ausschreiben
    const sourceText = expandAbbreviations(row.audio_intro_text!, row.language);
    console.log(
      `[audio-preprocess] ${introLabel} START (${sourceText.length} chars source)`
    );

    // Geprüfte Aussprache-Beispiele: Gemma schreibt neue Namen nach demselben Muster
    const examples = row.language === "de" ? examplesBlock() : "";
    const system = examples ? `${introSystemFor(row.language)}\n\n${examples}` : introSystemFor(row.language);

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

    setIntroTts(params.docId, variant, piece, result.model, stamp);

    console.log(
      `[audio-preprocess] ${introLabel} DONE in ${((Date.now() - tStart) / 1000).toFixed(1)}s ` +
        `(${sourceText.length} -> ${piece.length} chars, model=${result.model})`
    );

    return { text: piece, model: result.model, cached: false };
  });
}

// Nach Bearbeiten des Intro-Texts: nächster Lauf fragt Gemma neu
export function clearAudioIntroTtsCache(docId: string, variant: IntroVariant = "original"): void {
  setIntroTts(docId, variant, null, null, null);
}

export function preprocessIntroForAudio(...args: Parameters<typeof preprocessIntroForAudioImpl>): ReturnType<typeof preprocessIntroForAudioImpl> {
  return runJob("intro-preprocess", "audiobook", { docId: args[0].docId }, () => preprocessIntroForAudioImpl(...args));
}
