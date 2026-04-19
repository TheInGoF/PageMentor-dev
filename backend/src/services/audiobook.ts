import { join } from "path";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { join as pathJoin } from "path";
import { db } from "../db";
import { segmentText } from "../tts/segment";
import { synthesizeChunk, interChunkPause } from "../tts/synth";
import { concatMp3, normalizeAndTag, buildM4B } from "../tts/ffmpeg";
import { findVoice, defaultVoiceFor } from "../tts/voices";
import type { EngineId } from "../tts/engines/base";
import {
  preprocessChapterForAudio,
  preprocessAvailable,
} from "./audioPreprocess";
import { emit } from "./events";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";

interface Chapter {
  id: string;
  document_id: string;
  number: number;
  title: string;
  text: string;
  start_page: number;
  end_page: number;
  sort_order: number;
  kind?: string;
  include_in_audio?: number | null;
}

/** Default-Auswahl wenn `include_in_audio` für ein Kapitel noch nicht
 *  gesetzt ist (alte Rows vor v1.14.001). Pflegerelease-Kapitel
 *  (Übungen, Verzeichnisse) bleiben aus, content + summary an. */
function defaultIncludeForKind(kind: string | undefined): boolean {
  return kind === "content" || kind === "summary";
}

function isIncluded(ch: Pick<Chapter, "kind" | "include_in_audio">): boolean {
  if (ch.include_in_audio == null) return defaultIncludeForKind(ch.kind);
  return ch.include_in_audio === 1;
}

interface Document {
  id: string;
  title: string;
  language: string;
}

const running = new Map<string, AbortController>();

export function isGenerating(docId: string): boolean {
  return running.has(docId);
}

export class AudiobookCanceled extends Error {
  constructor() {
    super("audiobook.canceled");
    this.name = "AudiobookCanceled";
  }
}

/** Signalisiert dem laufenden Worker, nach dem aktuellen Chunk zu
 *  stoppen. Bereits fertige Kapitel bleiben erhalten. */
export function cancelAudiobook(docId: string): boolean {
  const ctrl = running.get(docId);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

export async function generateAudiobook(params: {
  docId: string;
  voiceId?: string;
  rate?: string;
}): Promise<void> {
  if (running.has(params.docId)) return;
  const abortController = new AbortController();
  running.set(params.docId, abortController);
  const signal = abortController.signal;

  const d = db();
  const doc = d.prepare("SELECT id, title, language FROM documents WHERE id = ?").get(params.docId) as
    | Document
    | undefined;
  if (!doc) {
    running.delete(params.docId);
    throw new Error("Document not found");
  }

  const allChapters = d
    .prepare(
      "SELECT id, document_id, number, title, text, start_page, end_page, sort_order, kind, include_in_audio FROM chapters WHERE document_id = ? ORDER BY sort_order ASC, number ASC"
    )
    .all(doc.id) as Chapter[];

  if (allChapters.length === 0) {
    running.delete(params.docId);
    throw new Error("No chapters - run chapter detection first.");
  }

  // User-Auswahl pro Kapitel respektieren. Falls keiner aktiv ist
  // (User hat alles ausgeknipst oder ein Edge-Case-Doc), fallen wir
  // auf die kind-basierte Default-Logik zurück damit überhaupt was
  // generiert wird.
  const filtered = allChapters.filter(isIncluded);
  const chapters = filtered.length > 0 ? filtered : allChapters;

  const voiceId = params.voiceId || defaultVoiceFor(doc.language);
  if (!voiceId) {
    running.delete(params.docId);
    throw new Error(
      "No TTS voice available for this language."
    );
  }
  const voice = findVoice(voiceId);
  if (!voice) {
    running.delete(params.docId);
    throw new Error(`Unknown voice: ${voiceId}`);
  }
  const engineId = voice.engine;
  const locale = voice.locale;
  const rate = params.rate || "+0%";

  const audioDir = join(DATA_DIR, "audio", doc.id);
  mkdirSync(audioDir, { recursive: true });

  emit({
    phase: "audiobook.start",
    docId: doc.id,
    total: chapters.length,
    message: `Generiere ${chapters.length} Kapitel mit ${voice?.label ?? voiceId}`,
  });

  // Preprocessor-Verfügbarkeit einmal vor der Loop checken — vermeidet
  // N Ollama-Pings, der `pickProvider()`-Cache hält 30 s.
  const llmReady = await preprocessAvailable();
  if (!llmReady) {
    console.warn(
      `[audiobook] LLM-Preprocessor nicht verfügbar — verwende Original-Text. Hörbuch klingt evtl. holprig (Abkürzungen, Zitate, Formeln).`
    );
  }

  const successfulChapterFiles: string[] = [];
  const chapterDurations: Array<{ title: string; durationMs: number }> = [];
  // Circuit-Breaker: wenn Edge zwei Kapitel hintereinander mit Empty-
  // Audio scheitert, ist Azure in der Quota-Bremse und weitere Kapitel
  // werden genauso scheitern. Abbrechen spart Zeit und räumt klar auf.
  let consecutiveEdgeEmpty = 0;
  let tripped = false;
  const EDGE_EMPTY_CIRCUIT_BREAKER = 2;

  try {
    for (let i = 0; i < chapters.length; i++) {
      if (signal.aborted) throw new AudiobookCanceled();
      const ch = chapters[i];
      const outFile = chapterFile(audioDir, ch);

      // Preprocessing: LLM bereinigt den Text für TTS (Abkürzungen
      // ausschreiben, Formeln verbalisieren, Zitate raus). Cached in
      // `chapters.audio_text` — beim zweiten Run kein LLM-Call mehr.
      // Fehlschlag oder LLM offline → Fallback auf Original-Text, weil
      // ein holpriges Hörbuch immer noch besser ist als gar keins.
      let chapterText = ch.text;
      if (llmReady) {
        try {
          emit({
            phase: "audiobook.chapter.preprocess",
            docId: doc.id,
            chapterId: ch.id,
            chapterNumber: ch.number,
            current: i + 1,
            total: chapters.length,
          });
          const pp = await preprocessChapterForAudio({
            chapterId: ch.id,
            language: doc.language,
          });
          chapterText = pp.text;
        } catch (err) {
          console.warn(
            `[audiobook] preprocess failed for chapter ${ch.number}, falling back to raw text:`,
            err
          );
        }
      }

      emit({
        phase: "audiobook.chapter.start",
        docId: doc.id,
        chapterId: ch.id,
        chapterNumber: ch.number,
        current: i + 1,
        total: chapters.length,
        message: ch.title || `Kapitel ${ch.number}`,
      });

      try {
        const { durationMs } = await synthesizeChapter({
          chapter: { ...ch, text: chapterText },
          audioDir,
          voice,
          locale,
          rate,
          outFile,
          signal,
          onChunk: (chunkIdx, chunkTotal) =>
            emit({
              phase: "audiobook.chapter.progress",
              docId: doc.id,
              chapterId: ch.id,
              chapterNumber: ch.number,
              current: chunkIdx,
              total: chunkTotal,
            }),
        });

        upsertAudio({
          chapterId: ch.id,
          storedRelPath: relPath(outFile),
          durationMs,
          voice: voiceId,
          engine: engineId,
          status: "done",
        });

        successfulChapterFiles.push(outFile);
        chapterDurations.push({
          title: ch.title || `Kapitel ${ch.number}`,
          durationMs,
        });

        consecutiveEdgeEmpty = 0;
        emit({
          phase: "audiobook.chapter.done",
          docId: doc.id,
          chapterId: ch.id,
          chapterNumber: ch.number,
          current: i + 1,
          total: chapters.length,
        });
      } catch (err) {
        if (err instanceof AudiobookCanceled) throw err;
        // Kein Failed-DB-Row mehr anlegen — nutzlos, muss nur manuell
        // aufgeräumt werden. Wenn ein früherer Run eine alte Datei/Row
        // für dieses Kapitel hinterlassen hat, jetzt wegräumen, damit
        // das UI das Kapitel sauber als "noch kein Audio" anzeigt.
        deleteAudioForChapter(ch.id, outFile);
        const message = err instanceof Error ? err.message : String(err);
        const isEdgeEmpty = engineId === "edge" && /empty audio/i.test(message);
        if (isEdgeEmpty) consecutiveEdgeEmpty++;
        else consecutiveEdgeEmpty = 0;

        emit({
          phase: "audiobook.chapter.failed",
          docId: doc.id,
          chapterId: ch.id,
          chapterNumber: ch.number,
          current: i + 1,
          total: chapters.length,
          message,
        });
        console.error(`[tts] chapter ${ch.number} failed:`, err);

        if (consecutiveEdgeEmpty >= EDGE_EMPTY_CIRCUIT_BREAKER) {
          const reason =
            `Edge TTS (Microsoft) antwortet mit leerem Audio — Azure-Quota erreicht. ` +
            `Bereits fertige Kapitel bleiben erhalten. ` +
            `Wechsle auf eine Kokoro-Stimme (lokal, ohne Quota) und generiere die fehlenden Kapitel neu.`;
          emit({
            phase: "audiobook.failed",
            docId: doc.id,
            message: reason,
          });
          console.error(`[tts] aborting book: ${reason}`);
          tripped = true;
          break;
        }
      }
    }

    // Wenn der Circuit-Breaker ausgelöst hat, überspringen wir M4B-Build
    // und das Done-Event — der Failed-Event ist bereits raus, und ein
    // Done-Event würde den Client-State ins Inkonsistente kippen.
    if (!tripped) {
      if (successfulChapterFiles.length > 0) {
        emit({
          phase: "audiobook.book.building",
          docId: doc.id,
          message: "Baue M4B mit Kapitelmarken …",
        });

        // Wenn ein Intro-MP3 existiert, als Track 0 voranstellen.
        // Duration via ffprobe (innerhalb buildM4B) — wir geben hier
        // 0 vor, ffmpeg ermittelt die echte Länge selbst.
        // Chapter-Marker-Label sprachabhängig — wird nur im Player
        // angezeigt, nicht vorgelesen.
        const introPath = join(audioDir, "intro.mp3");
        const inputs = [...successfulChapterFiles];
        const m4bChapters = [...chapterDurations];
        if (existsSync(introPath)) {
          inputs.unshift(introPath);
          const introLabel = doc.language === "de" ? "Einleitung" : "Intro";
          m4bChapters.unshift({ title: introLabel, durationMs: 0 });
        }

        const bookPath = join(audioDir, "book.m4b");
        try {
          await buildM4B({
            inputs,
            chapters: m4bChapters,
            output: bookPath,
            title: doc.title,
            coverPath: coverPathFor(doc.id),
          });
        } catch (err) {
          console.error(`[tts] M4B build failed:`, err);
        }
      }

      emit({ phase: "audiobook.done", docId: doc.id, total: chapters.length });
    }
  } catch (err) {
    if (err instanceof AudiobookCanceled) {
      emit({
        phase: "audiobook.canceled",
        docId: doc.id,
        message: "aborted by user",
      });
    } else {
      emit({
        phase: "audiobook.failed",
        docId: doc.id,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  } finally {
    running.delete(params.docId);
  }
}

/**
 * Erzeugt Audio für EIN Kapitel. Im Gegensatz zu `generateAudiobook`
 * läuft hier kein Preprocessor, es wird kein M4B gebaut und es gibt
 * keinen Circuit-Breaker — der Caller weiß was er tut (UI-Flow: User
 * hat das Kapitel explizit ausgewählt und ggf. den audio_text bereits
 * kuratiert).
 *
 * Nutzt `audio_text` wenn gesetzt, fällt sonst auf `text` zurück.
 * Das Ergebnis wird wie bei der Full-Pipeline in der `audio`-Tabelle
 * persistiert + ffmpeg-normalisiert.
 */
export async function generateSingleChapterAudio(params: {
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

  const voice = findVoice(params.voiceId);
  if (!voice) throw new Error(`Unknown voice: ${params.voiceId}`);
  const rate = params.rate || "+0%";

  // audio_text bevorzugt — der User hat ihn ggf. manuell kuratiert.
  const effectiveText = (row.audio_text && row.audio_text.trim().length > 0)
    ? row.audio_text
    : row.text;

  const audioDir = join(DATA_DIR, "audio", row.document_id);
  mkdirSync(audioDir, { recursive: true });
  const outFile = chapterFile(audioDir, row as Chapter);

  // Abort-Signal akzeptieren wir hier nicht von außen — Single-Chapter-
  // Runs sollen kurz genug sein dass Cancel via UI unnötig ist. Im
  // Fehlerfall propagiert der Exception nach oben.
  const abortController = new AbortController();

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
    message: row.title || `Kapitel ${row.number}`,
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
    });

    // Book-M4B ist jetzt veraltet (beinhaltet dieses Kapitel evtl.
    // nicht oder noch die alte Version). Löschen damit der Download-
    // Button offline geht bis ein neuer Full-Run läuft.
    const bookPath = join(audioDir, "book.m4b");
    if (existsSync(bookPath)) {
      try {
        rmSync(bookPath, { force: true });
      } catch {
        // best effort
      }
    }

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
  }
}

/** Erzeugt das Intro-Audio (eine .mp3 die vor dem ersten Kapitel
 *  liegt). Nutzt denselben TTS-Pfad wie ein Kapitel, aber speichert
 *  als deterministischer Pfad `audio/{docId}/intro.mp3` ohne DB-Eintrag. */
export async function generateIntroAudio(params: {
  docId: string;
  text: string;
  voiceId: string;
  rate?: string;
}): Promise<{ path: string; durationMs: number }> {
  const voice = findVoice(params.voiceId);
  if (!voice) throw new Error(`Unknown voice: ${params.voiceId}`);
  const rate = params.rate || "+0%";

  const audioDir = join(DATA_DIR, "audio", params.docId);
  mkdirSync(audioDir, { recursive: true });
  const outFile = join(audioDir, "intro.mp3");

  // Bestehendes M4B invalidieren — neuer Intro = altes Buch passt nicht mehr.
  const bookPath = join(audioDir, "book.m4b");
  if (existsSync(bookPath)) {
    try {
      rmSync(bookPath, { force: true });
    } catch {
      /* best effort */
    }
  }

  emit({
    phase: "audiobook.chapter.start",
    docId: params.docId,
    chapterNumber: 0,
    current: 1,
    total: 1,
    message: "Intro",
  });

  const abortController = new AbortController();
  // Synthetisches Single-Chapter. Title ist bewusst LEER — der
  // User-Intro-Text ("Hörbuch: Foo. Verfasst von Bar.") ist selbst-
  // erklärend, eine zusätzliche TTS-Ansage "Intro." vornweg würde
  // redundant wirken. Plus: Edge erkennt "Intro" als englisches
  // Lehnwort und spricht es englisch aus — macht es holprig.
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
      onChunk: (current, total) =>
        emit({
          phase: "audiobook.chapter.progress",
          docId: params.docId,
          chapterNumber: 0,
          current,
          total,
        }),
    });
    emit({
      phase: "audiobook.chapter.done",
      docId: params.docId,
      chapterNumber: 0,
      current: 1,
      total: 1,
    });
    return { path: outFile, durationMs };
  } catch (err) {
    emit({
      phase: "audiobook.chapter.failed",
      docId: params.docId,
      chapterNumber: 0,
      current: 1,
      total: 1,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function synthesizeChapter(params: {
  chapter: Chapter;
  audioDir: string;
  voice: import("../tts/engines/base").Voice;
  locale: string;
  rate: string;
  outFile: string;
  signal: AbortSignal;
  onChunk: (current: number, total: number) => void;
}): Promise<{ durationMs: number }> {
  const { chapter, audioDir, voice, locale, rate, outFile, signal } = params;

  if (!chapter.text || chapter.text.trim().length < 20) {
    throw new Error("Chapter text is too short or empty.");
  }

  const tmpDir = join(audioDir, `.tmp-${chapter.id}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    const segments = segmentText(chapter.text);
    if (segments.length === 0) throw new Error("Keine Segmente aus Kapiteltext.");

    const isDe = params.voice.locale.startsWith("de");

    const chunkFiles: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted) throw new AudiobookCanceled();
      // Erste Chunk bekommt eine Kapitel-Ansage davor — außer das
      // synthetische "Kapitel" hat number 0 + leeren title (= Intro).
      // Dann ist der eigentliche User-Text selbst-erklärend, wir
      // wollen kein doppeltes "Intro." vorweg.
      //
      // Ein "Kapitel:" / "Chapter:" wird immer vorangestellt wenn
      // der Titel nicht schon mit dem Wort beginnt — das gibt Edge
      // einen klaren Sprach-Kontext beim ersten Wort, sonst wird
      // ein deutsches "Vorwort" als englisches "worword" gesprochen
      // (Lehnwort-Ambiguität, Edge fällt auf EN als Default zurück).
      const explicitTitle = chapter.title?.trim();
      let announcement: string | undefined;
      if (i === 0) {
        if (explicitTitle) {
          const alreadyPrefixed = isDe
            ? /^(kapitel|abschnitt|teil)\b/i.test(explicitTitle)
            : /^(chapter|section|part)\b/i.test(explicitTitle);
          if (alreadyPrefixed) {
            announcement = explicitTitle;
          } else {
            announcement = isDe
              ? `Kapitel: ${explicitTitle}`
              : `Chapter: ${explicitTitle}`;
          }
        } else if (chapter.number > 0) {
          announcement = isDe
            ? `Kapitel ${chapter.number}`
            : `Chapter ${chapter.number}`;
        }
      }
      const paragraphText = segments[i].paragraphs.join("\n\n");
      const plainText = announcement
        ? `${announcement}.\n\n${paragraphText}`
        : paragraphText;
      const chunkPath = join(tmpDir, `chunk-${String(i).padStart(3, "0")}.mp3`);
      const { engineId } = await synthesizeChunk({
        segment: segments[i],
        text: plainText,
        voice,
        locale,
        rate,
        announce: announcement,
        outPath: chunkPath,
        signal,
      });
      chunkFiles.push(chunkPath);
      params.onChunk(i + 1, segments.length);
      if (i < segments.length - 1) {
        await interChunkPause(engineId);
      }
    }

    const mergedPath = join(tmpDir, "merged.mp3");
    if (chunkFiles.length === 1) {
      // Kein Concat nötig
      await run_rename(chunkFiles[0], mergedPath);
    } else {
      await concatMp3(chunkFiles, mergedPath);
    }

    const cover = coverPathFor(chapter.document_id);
    const { durationMs } = await normalizeAndTag({
      input: mergedPath,
      output: outFile,
      title: chapter.title || `Kapitel ${chapter.number}`,
      album: await documentTitle(chapter.document_id),
      trackNumber: chapter.number,
      coverPath: cover,
    });

    return { durationMs };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

async function run_rename(src: string, dest: string): Promise<void> {
  const { rename } = await import("fs/promises");
  await rename(src, dest);
}

function coverPathFor(docId: string): string | undefined {
  // pdftoppm writes "{base}-1.jpg" (single-digit) for single-page renders.
  for (const candidate of [
    pathJoin(DATA_DIR, "covers", `${docId}-1.jpg`),
    pathJoin(DATA_DIR, "covers", `${docId}-01.jpg`),
    pathJoin(DATA_DIR, "covers", `${docId}.jpg`),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function documentTitle(docId: string): Promise<string> {
  const row = db().prepare("SELECT title FROM documents WHERE id = ?").get(docId) as
    | { title: string }
    | undefined;
  return row?.title ?? "PageMentor";
}

function relPath(abs: string): string {
  return abs.startsWith(DATA_DIR + "/") || abs.startsWith(DATA_DIR + "\\")
    ? abs.slice(DATA_DIR.length + 1)
    : abs;
}

function chapterFile(dir: string, ch: Chapter): string {
  return join(dir, `chapter-${String(ch.number).padStart(3, "0")}-${ch.id}.mp3`);
}

function upsertAudio(params: {
  chapterId: string;
  storedRelPath: string;
  durationMs: number;
  voice: string;
  engine: EngineId;
  status: "done" | "failed" | "running" | "pending";
}): void {
  const d = db();
  const existing = d.prepare("SELECT id FROM audio WHERE chapter_id = ?").get(params.chapterId) as
    | { id: string }
    | undefined;
  if (existing) {
    d.prepare(
      "UPDATE audio SET stored_path = ?, duration_ms = ?, engine = ?, voice = ?, status = ? WHERE chapter_id = ?"
    ).run(
      params.storedRelPath,
      params.durationMs,
      params.engine,
      params.voice,
      params.status,
      params.chapterId
    );
  } else {
    d.prepare(
      "INSERT INTO audio (id, chapter_id, stored_path, duration_ms, engine, voice, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      randomUUID(),
      params.chapterId,
      params.storedRelPath,
      params.durationMs,
      params.engine,
      params.voice,
      params.status
    );
  }
}

/** Entfernt Audio-Row + MP3-Datei für ein einzelnes Kapitel. Wird beim
 *  Scheitern einer Synthese aufgerufen, damit die Bibliothek keinen
 *  toten Failed-Eintrag zurücklässt. */
function deleteAudioForChapter(chapterId: string, chapterFilePath: string): void {
  try {
    if (existsSync(chapterFilePath)) rmSync(chapterFilePath, { force: true });
  } catch {
    // best effort
  }
  db().prepare("DELETE FROM audio WHERE chapter_id = ?").run(chapterId);
}

/** Entfernt alle generierten Hörbuch-Dateien für ein Dokument. */
export function clearAudio(docId: string): void {
  const dir = join(DATA_DIR, "audio", docId);
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      rmSync(full, { recursive: true, force: true });
    }
  }
  db().prepare(
    `DELETE FROM audio WHERE chapter_id IN (SELECT id FROM chapters WHERE document_id = ?)`
  ).run(docId);
}

/** Entfernt eine einzelne Kapitel-Audio-Datei + DB-Row. Das Buch-M4B
 *  wird ebenfalls verworfen, weil es sonst auf eine nicht mehr
 *  existente Spur verweist. */
export function clearAudioForChapter(audioId: string): boolean {
  const d = db();
  const row = d
    .prepare(
      `SELECT a.id, a.stored_path, c.document_id
       FROM audio a JOIN chapters c ON c.id = a.chapter_id
       WHERE a.id = ?`
    )
    .get(audioId) as { id: string; stored_path: string; document_id: string } | undefined;
  if (!row) return false;

  const fullPath = join(DATA_DIR, row.stored_path);
  if (existsSync(fullPath)) {
    try {
      rmSync(fullPath, { force: true });
    } catch {
      // best effort — DB row wird trotzdem entfernt, damit das UI aufräumt
    }
  }

  const bookPath = join(DATA_DIR, "audio", row.document_id, "book.m4b");
  if (existsSync(bookPath)) {
    try {
      rmSync(bookPath, { force: true });
    } catch {
      // best effort
    }
  }

  d.prepare("DELETE FROM audio WHERE id = ?").run(audioId);
  return true;
}

