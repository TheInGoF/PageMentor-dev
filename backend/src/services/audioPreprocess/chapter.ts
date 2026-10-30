// Kapiteltext hörgerecht machen: Abkürzungen, Zahlen, Formeln, Zitate
// Inhalt bleibt gleich, nur die Form ändert sich
// Ergebnis wird in chapters.audio_text gecacht

import { db } from "../../db";
import { generate, isAvailable as llmAvailable } from "../llm";
import { expandAbbreviations } from "../abbreviations";
import { withGemmaLock } from "../gemmaLock";
import { cleanupHints } from "../promptHints";
import { systemFor } from "./prompts";
import { gemmaStamp } from "../stamps";
import { examplesBlock } from "../pronunciation";
import {
  stripLeadingSectionNumbers,
  splitForPreprocess,
  stripWrappers,
  restoreHeadingParagraphs,
} from "./textCleanup";
import { stripProblematicCharsForTts } from "./ttsChars";
import { fixGermanNumeralBleed } from "./numerals";
import { runJob } from "../../log/jobs";

interface ChapterRow {
  id: string;
  text: string;
  audio_text: string | null;
  audio_text_model: string | null;
  document_id: string;
  number: number;
  title: string;
}

export async function preprocessAvailable(): Promise<boolean> {
  return llmAvailable();
}

export interface PreprocessResult {
  text: string;
  model: string;
  cached: boolean;
}

// Cache-Treffer sofort, sonst LLM-Lauf + Speichern
// Ohne LLM entscheidet der Aufrufer über den Fallback
async function preprocessChapterForAudioImpl(params: {
  chapterId: string;
  language: string;
  model?: string;
  // Cache ignorieren
  force?: boolean;
}): Promise<PreprocessResult> {
  const d = db();
  const row = d
    .prepare(
      "SELECT id, text, audio_text, audio_text_model, audio_text_stamp, document_id, number, title FROM chapters WHERE id = ?"
    )
    .get(params.chapterId) as
    | (ChapterRow & { number: number; title: string; audio_text_stamp: string | null })
    | undefined;
  if (!row) throw new Error(`Chapter ${params.chapterId} not found`);
  const chapterLabel = `chapter ${row.number}${row.title ? ` "${row.title.slice(0, 40)}"` : ""}`;

  // Gilt nur, wenn von Hand bearbeitet oder mit der aktuellen Anweisung entstanden
  // Zweisprachiges Buch: die Bereinigung lässt die Fremdsprache stehen (Hinweis unten, zählt zum Stempel)
  const lang2 = (d.prepare("SELECT second_language FROM documents WHERE id = ?").get(row.document_id) as { second_language: string | null } | undefined)?.second_language ?? "";
  const stamp = gemmaStamp("chapter", params.language, lang2);
  const fresh = row.audio_text_model === "manual-edit" || row.audio_text_stamp === stamp;
  if (!params.force && row.audio_text && row.audio_text.trim().length > 0 && !fresh) {
    console.log(`[audio-preprocess] ${chapterLabel} veraltet (andere Anweisung oder Version), neu aufbereiten`);
  }
  if (
    !params.force &&
    fresh &&
    row.audio_text &&
    row.audio_text.trim().length > 0
  ) {
    console.log(
      `[audio-preprocess] ${chapterLabel} cache hit (${row.audio_text.length} chars, model=${row.audio_text_model ?? "?"})`
    );
    return {
      text: row.audio_text,
      model: row.audio_text_model ?? "cached",
      cached: true,
    };
  }

  if (!row.text || row.text.trim().length < 20) {
    throw new Error("Chapter text too short to preprocess");
  }

  // Ab hier Gemma: global serialisiert
  return withGemmaLock(chapterLabel, async () => {
    const tStart = Date.now();
    console.log(
      `[audio-preprocess] ${chapterLabel} START (${row.text.length} chars source)`
    );

    // Deterministischer Vorlauf, der Prompt weiß davon
    const expanded = expandAbbreviations(row.text, params.language);
    const pretreated = stripLeadingSectionNumbers(expanded);

    // "audio"-Hinweise: Formeln beschreiben statt LaTeX
    const baseSystem = systemFor(params.language);
    const system = `${baseSystem}\n\n${cleanupHints(
      params.language === "de" ? "de" : "en",
      "audio"
    )}${params.language === "de" && examplesBlock() ? `\n\n${examplesBlock()}` : ""}${lang2 ? `\n\nDIESES BUCH UNTERRICHTET EINE FREMDSPRACHE (${lang2}). Alle Wörter, Sätze und Vokabeln in dieser Sprache bleiben Zeichen für Zeichen unverändert: nicht übersetzen, nicht eindeutschen, nicht in Lautschrift umschreiben, Satzzeichen wie ¿ ¡ behalten.` : ""}`;

    // num_ctx: Ollama-Standard 2048 ist viel zu klein
    // num_predict: endlich, "-1" ignorieren manche Ollama-Builds
    const ollamaOptions = {
      temperature: 0.1,
      top_p: 0.9,
      num_ctx: 65536,
      num_predict: 18000,
    };

    // Teilstücke à 6000 Zeichen
    // Größere Stücke: Gemma e4b vergisst Regeln ab der Mitte
    const subChunks = splitForPreprocess(pretreated, 6000);
    if (subChunks.length > 1) {
      console.log(
        `[audio-preprocess] ${chapterLabel} (${pretreated.length} chars) → ` +
          `${subChunks.length} sub-chunks for LLM (~${Math.round(pretreated.length / subChunks.length)} chars each)`
      );
    }

    const responses: string[] = [];
    let lastModel = "(unknown)";
    for (let i = 0; i < subChunks.length; i++) {
      const chunk = subChunks[i];
      const label = subChunks.length > 1 ? ` [${i + 1}/${subChunks.length}]` : "";
      const t0 = Date.now();

      let result = await generate({
        prompt: chunk,
        system,
        model: params.model,
        options: ollamaOptions,
      });

      if (!result.response || result.response.trim().length < 20) {
        console.warn(
          `[audio-preprocess]${label} empty/short response from ${result.model} ` +
            `(${result.response.length} chars, reason=${result.doneReason ?? "?"}, ` +
            `output_tokens=${result.outputTokens ?? "?"}), input ${chunk.length} chars — retrying after 2s`
        );
        await new Promise((r) => setTimeout(r, 2000));
        result = await generate({
          prompt: chunk,
          system,
          model: params.model,
          options: ollamaOptions,
        });
      }

      const piece = result.response.trim();
      if (piece.length < 20) {
        // Stop-Grund in klaren Hinweis übersetzen
        const hint =
          result.doneReason === "length"
            ? "Model hit num_predict — raise it or shrink chunk size."
            : result.doneReason === "load"
            ? "Model still loading on the Ollama side — retry in a moment."
            : (result.outputTokens ?? 0) === 0
            ? "Model returned 0 output tokens — likely a context overflow or chat-template mismatch. Try a different model."
            : "Try a different model or shrink the chunk size.";
        throw new Error(
          `Preprocessor returned only ${piece.length} chars for sub-chunk${label} ` +
            `(model=${result.model}, reason=${result.doneReason ?? "?"}, ` +
            `output_tokens=${result.outputTokens ?? "?"}, input ${chunk.length} chars). ${hint}`
        );
      }

      // Zahlwort-Brei: reparieren, sonst einmal mit Feedback wiederholen
      let firstPass = fixGermanNumeralBleed(piece);
      let bestPiece = firstPass.text;
      let bestRejects = firstPass.rejected;

      if (firstPass.rejected.length > 0) {
        console.warn(
          `[audio-preprocess]${label} numeral bleed (${firstPass.rejected.length}): ` +
            `${firstPass.rejected.slice(0, 5).join(", ")}` +
            `${firstPass.rejected.length > 5 ? ", …" : ""} — retry with feedback`
        );
        const retrySystem =
          system +
          "\n\n================================================================\n" +
          "RETRY-FEEDBACK\n" +
          "================================================================\n" +
          "Dein vorheriger Versuch produzierte unsprechbare Wort-Mashes:\n" +
          firstPass.rejected.map((r) => `  - "${r}"`).join("\n") +
          "\n\nLass an diesen Stellen die ZIFFERN stehen. Verbalisiere Jahres- und " +
          "Abschnittszahlen NICHT zu deutschen Wort-Compounds. " +
          '"2018" bleibt "2018", "Beispiel 2.5" bleibt "Beispiel 2.5".\n';
        const retry = await generate({
          prompt: chunk,
          system: retrySystem,
          model: params.model,
          options: ollamaOptions,
        });
        const retryPiece = retry.response?.trim() ?? "";
        if (retryPiece.length >= 20) {
          const retryPass = fixGermanNumeralBleed(retryPiece);
          if (retryPass.rejected.length < firstPass.rejected.length) {
            bestPiece = retryPass.text;
            bestRejects = retryPass.rejected;
            result = retry;
            console.log(
              `[audio-preprocess]${label} retry improved: ` +
                `${firstPass.rejected.length} → ${retryPass.rejected.length} rejects`
            );
          } else {
            console.warn(
              `[audio-preprocess]${label} retry did not improve ` +
                `(${retryPass.rejected.length} rejects), keeping first attempt`
            );
          }
        }
      }

      if (bestRejects.length > 0) {
        console.warn(
          `[audio-preprocess]${label} ${bestRejects.length} unrecoverable garbled tokens persist: ` +
            bestRejects.join(", ")
        );
      }

      lastModel = result.model;
      responses.push(bestPiece);
      console.log(
        `[audio-preprocess]${label} done in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
          `(input ${chunk.length}c → output ${bestPiece.length}c, model=${result.model})`
      );
    }

    const combined = responses.join("\n\n");
    // Nochmal auf dem Gesamttext: Fälle über Stückgrenzen hinweg
    const numeralFixed = fixGermanNumeralBleed(combined).text;
    // Nachlauf: Gemma macht Vorlauf-Änderungen teils rückgängig
    const postPassed =
      params.language === "de"
        ? expandAbbreviations(numeralFixed, params.language)
        : numeralFixed;
    // Reihenfolge wichtig: Überschriften erkennen braucht noch die Nummern
    const headingsRestored = restoreHeadingParagraphs(stripWrappers(postPassed));
    // Falls Gemma Nummern wieder eingefügt hat
    const sectionStripped = stripLeadingSectionNumbers(headingsRestored);
    const cleaned = stripProblematicCharsForTts(
      sectionStripped,
      params.language === "de" ? "de" : "en"
    );
    if (!cleaned || cleaned.length < 20) {
      throw new Error(
        `Preprocessor aggregate returned only ${cleaned.length} chars after joining ` +
          `${subChunks.length} sub-chunks (model=${lastModel}).`
      );
    }

    d.prepare(
      "UPDATE chapters SET audio_text = ?, audio_text_model = ?, audio_text_stamp = ? WHERE id = ?"
    ).run(cleaned, lastModel, stamp, params.chapterId);

    const totalSeconds = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(
      `[audio-preprocess] ${chapterLabel} DONE in ${totalSeconds}s ` +
        `(${row.text.length} → ${cleaned.length} chars, model=${lastModel}, sub-chunks=${subChunks.length})`
    );

    return { text: cleaned, model: lastModel, cached: false };
  });
}

// Cache leeren, z. B. nach Modellwechsel oder Textänderung
export function clearAudioTextCache(chapterId: string): void {
  db()
    .prepare(
      "UPDATE chapters SET audio_text = NULL, audio_text_model = NULL WHERE id = ?"
    )
    .run(chapterId);
}

export function clearAudioTextCacheForDocument(documentId: string): void {
  db()
    .prepare(
      "UPDATE chapters SET audio_text = NULL, audio_text_model = NULL WHERE document_id = ?"
    )
    .run(documentId);
}

export function preprocessChapterForAudio(...args: Parameters<typeof preprocessChapterForAudioImpl>): ReturnType<typeof preprocessChapterForAudioImpl> {
  return runJob("preprocess", "audiobook", { chapterId: args[0].chapterId }, () => preprocessChapterForAudioImpl(...args));
}
