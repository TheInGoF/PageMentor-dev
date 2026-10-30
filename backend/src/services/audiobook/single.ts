// Einzelnes Kapitel und Intro erzeugen
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { findVoice } from "../../tts/voices";
import { emit } from "../events";
import { pickLang, tLang, chapterLabel } from "../../lib/i18n";
import { running, type Chapter } from "./state";
import { chapterFile, deleteAudioForChapter, relPath, upsertAudio } from "./files";
import { synthesizeChapter } from "./synthChapter";
import { runJob } from "../../log/jobs";
import { ttsStamp } from "../stamps";

// Audio für EIN Kapitel
// Ohne LLM-Aufbereitung, ohne M4B, ohne Fehlerzähler
// Nutzt audio_text, sonst text
async function generateSingleChapterAudioImpl(params: {
  chapterId: string;
  voiceId: string;
  rate?: string;
}): Promise<{ audioId: string; durationMs: number }> {
  const d = db();
  const row = d
    .prepare(
      `SELECT c.id, c.document_id, c.number, c.title, c.text, c.audio_text,
              c.start_page, c.end_page, c.sort_order, c.kind,
              doc.title as doc_title, doc.language
       FROM chapters c
       JOIN documents doc ON doc.id = c.document_id
       WHERE c.id = ?`
    )
    .get(params.chapterId) as
    | (Chapter & { audio_text: string | null; doc_title: string; language: string })
    | undefined;
  if (!row) throw new Error("Chapter not found");

  const voice = findVoice(params.voiceId, row.language);
  if (!voice) throw new Error(`Unknown voice: ${params.voiceId}`);
  const rate = params.rate || "+0%";

  // audio_text bevorzugen, evtl. von Hand bearbeitet
  const effectiveText = (row.audio_text && row.audio_text.trim().length > 0)
    ? row.audio_text
    : row.text;

  const audioDir = join(DATA_DIR, "audio", row.document_id);
  mkdirSync(audioDir, { recursive: true });
  const outFile = chapterFile(audioDir, row as Chapter);

  // Alte Zeile ohne done-Status verwerfen
  const staleAudio = db()
    .prepare("SELECT status FROM audio WHERE chapter_id = ?")
    .get(row.id) as { status: string } | undefined;
  if (staleAudio && staleAudio.status !== "done") {
    console.log(
      `[audiobook] single-chapter: dropping stale audio row (status=${staleAudio.status}) for chapter ${row.id}`
    );
    deleteAudioForChapter(row.id, outFile);
  }

  // Auch Einzelläufe registrieren, damit Abbrechen greift
  // Läuft schon ein Buch: dessen Controller teilen
  const existingRun = running.get(row.document_id);
  const alreadyRunning = !!existingRun;
  const abortController = existingRun?.ctrl ?? new AbortController();
  if (!alreadyRunning) {
    running.set(row.document_id, {
      ctrl: abortController,
      startedAt: Date.now(),
      totalChapters: 1,
      currentChapter: 1,
      chunkCurrent: 0,
      chunkTotal: 0,
      chapterChars: [effectiveText.length],
    });
  }

  const chapterForSynth: Chapter = {
    ...row,
    text: effectiveText,
    kind: row.kind,
  };

  emit({
    phase: "audiobook.chapter.start",
    docId: row.document_id,
    chapterId: row.id,
    chapterNumber: row.number,
    current: 1,
    total: 1,
    message: row.title || chapterLabel(pickLang(row.language), row.number),
  });
  try {
    const { durationMs } = await synthesizeChapter({
      chapter: chapterForSynth,
      audioDir,
      voice,
      locale: voice.locale,
      rate,
      outFile,
      signal: abortController.signal,
      onChunk: (current, total) =>
        emit({
          phase: "audiobook.chapter.progress",
          docId: row.document_id,
          chapterId: row.id,
          chapterNumber: row.number,
          current,
          total,
        }),
    });

    upsertAudio({
      chapterId: row.id,
      storedRelPath: relPath(outFile),
      durationMs,
      voice: params.voiceId,
      engine: voice.engine,
      status: "done",
      stamp: ttsStamp(effectiveText, params.voiceId, rate, voice.locale),
    });

    // M4B ist jetzt veraltet: löschen
    const bookPath = join(audioDir, "book.m4b");
    if (existsSync(bookPath)) {
      try {
        rmSync(bookPath, { force: true });
      } catch {
        // best effort
      }
    }

    // Vor dem Abschluss-Event austragen
    if (!alreadyRunning) running.delete(row.document_id);
    emit({
      phase: "audiobook.chapter.done",
      docId: row.document_id,
      chapterId: row.id,
      chapterNumber: row.number,
      current: 1,
      total: 1,
    });

    const audioIdRow = d
      .prepare("SELECT id FROM audio WHERE chapter_id = ?")
      .get(row.id) as { id: string } | undefined;

    return { audioId: audioIdRow?.id ?? "", durationMs };
  } catch (err) {
    if (!alreadyRunning) running.delete(row.document_id);
    emit({
      phase: "audiobook.chapter.failed",
      docId: row.document_id,
      chapterId: row.id,
      chapterNumber: row.number,
      current: 1,
      total: 1,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    if (!alreadyRunning) running.delete(row.document_id);
  }
}

// Jede Zeile mit Satzzeichen beenden: ohne liest die Stimme Zeilen ineinander
export function introSpeechText(text: string): string {
  return text
    .split("\n")
    .map((l) => (l.trim() && !/[.!?…:]$/.test(l.trim()) ? `${l.trimEnd()}.` : l))
    .join("\n");
}

// Intro-Audio vor dem ersten Kapitel
// Fester Pfad audio/{docId}/intro.mp3, keine DB-Zeile
async function generateIntroAudioImpl(params: {
  docId: string;
  text: string;
  voiceId: string;
  rate?: string;
  // Im Buch-Lauf: keine eigenen Kapitel-Events, das Buch meldet den Fortschritt
  inBook?: boolean;
}): Promise<{ path: string; durationMs: number }> {
  const say: typeof emit = params.inBook ? () => {} : emit;
  const introDoc = db()
    .prepare("SELECT language FROM documents WHERE id = ?")
    .get(params.docId) as { language: string } | undefined;
  const lang = pickLang(introDoc?.language);

  const voice = findVoice(params.voiceId, lang);
  if (!voice) throw new Error(`Unknown voice: ${params.voiceId}`);
  const rate = params.rate || "+0%";

  const audioDir = join(DATA_DIR, "audio", params.docId);
  mkdirSync(audioDir, { recursive: true });
  const outFile = join(audioDir, "intro.mp3");

  // Neues Intro: altes M4B passt nicht mehr
  const bookPath = join(audioDir, "book.m4b");
  if (existsSync(bookPath)) {
    try {
      rmSync(bookPath, { force: true });
    } catch {
      /* best effort */
    }
  }

  say({
    phase: "audiobook.chapter.start",
    docId: params.docId,
    chapterNumber: 0,
    current: 1,
    total: 1,
    message: tLang(lang, "label.intro"),
  });

  const existingRun = running.get(params.docId);
  const alreadyRunning = !!existingRun;
  const abortController = existingRun?.ctrl ?? new AbortController();
  if (!alreadyRunning) {
    running.set(params.docId, {
      ctrl: abortController,
      startedAt: Date.now(),
      totalChapters: 1,
      currentChapter: 1,
      chunkCurrent: 0,
      chunkTotal: 0,
      chapterChars: [params.text.length],
    });
  }
  params.text = introSpeechText(params.text);
  // Leerer Titel: keine Ansage "Intro." vorweg
  const synth: Chapter = {
    id: `intro-${params.docId}`,
    document_id: params.docId,
    number: 0,
    title: "",
    text: params.text,
    start_page: 0,
    end_page: 0,
    sort_order: -1,
    kind: "meta",
  };

  try {
    const { durationMs } = await synthesizeChapter({
      chapter: synth,
      audioDir,
      voice,
      locale: voice.locale,
      rate,
      outFile,
      signal: abortController.signal,
      intro: true,
      onChunk: (current, total) =>
        say({
          phase: "audiobook.chapter.progress",
          docId: params.docId,
          chapterNumber: 0,
          current,
          total,
        }),
    });
    // Stempel merken: der Buch-Lauf erzeugt das Intro nur neu, wenn sich Text, Stimme oder Tempo ändern
    db().prepare("UPDATE documents SET audio_intro_stamp = ? WHERE id = ?").run(ttsStamp(params.text, params.voiceId, rate, voice.locale), params.docId);
    // Vor dem Abschluss-Event austragen, sonst hängt die UI
    if (!alreadyRunning) running.delete(params.docId);
    say({
      phase: "audiobook.chapter.done",
      docId: params.docId,
      chapterNumber: 0,
      current: 1,
      total: 1,
    });
    return { path: outFile, durationMs };
  } catch (err) {
    if (!alreadyRunning) running.delete(params.docId);
    say({
      phase: "audiobook.chapter.failed",
      docId: params.docId,
      chapterNumber: 0,
      current: 1,
      total: 1,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    // Sicherheitshalber nochmal
    if (!alreadyRunning) running.delete(params.docId);
  }
}

export function generateSingleChapterAudio(...args: Parameters<typeof generateSingleChapterAudioImpl>): ReturnType<typeof generateSingleChapterAudioImpl> {
  return runJob("chapter-audio", "audiobook", { chapterId: args[0].chapterId }, () => generateSingleChapterAudioImpl(...args));
}

export function generateIntroAudio(...args: Parameters<typeof generateIntroAudioImpl>): ReturnType<typeof generateIntroAudioImpl> {
  return runJob("intro-audio", "audiobook", { docId: args[0].docId }, () => generateIntroAudioImpl(...args));
}
