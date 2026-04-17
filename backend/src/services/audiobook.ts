import { join } from "path";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { join as pathJoin } from "path";
import { db } from "../db";
import { segmentText } from "../tts/segment";
import { synthesizeSegmentToFile } from "../tts/synth";
import { concatMp3, normalizeAndTag, buildM4B } from "../tts/ffmpeg";
import { findVoice, defaultVoiceFor } from "../tts/voices";
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
}

interface Document {
  id: string;
  title: string;
  language: string;
}

const running = new Set<string>();

export function isGenerating(docId: string): boolean {
  return running.has(docId);
}

export async function generateAudiobook(params: {
  docId: string;
  voiceId?: string;
  rate?: string;
}): Promise<void> {
  if (running.has(params.docId)) return;
  running.add(params.docId);

  const d = db();
  const doc = d.prepare("SELECT id, title, language FROM documents WHERE id = ?").get(params.docId) as
    | Document
    | undefined;
  if (!doc) {
    running.delete(params.docId);
    throw new Error("Document not found");
  }

  const chapters = d
    .prepare(
      "SELECT id, document_id, number, title, text, start_page, end_page, sort_order FROM chapters WHERE document_id = ? ORDER BY sort_order ASC, number ASC"
    )
    .all(doc.id) as Chapter[];

  if (chapters.length === 0) {
    running.delete(params.docId);
    throw new Error("No chapters - run chapter detection first.");
  }

  const voiceId = params.voiceId || defaultVoiceFor(doc.language);
  if (!voiceId) {
    running.delete(params.docId);
    throw new Error(
      "No Piper voice available. Rebuild the image with PIPER_LANGS including this language."
    );
  }
  const voice = findVoice(voiceId);

  const audioDir = join(DATA_DIR, "audio", doc.id);
  mkdirSync(audioDir, { recursive: true });

  emit({
    phase: "audiobook.start",
    docId: doc.id,
    total: chapters.length,
    message: `Generiere ${chapters.length} Kapitel mit ${voice?.label ?? voiceId}`,
  });

  const successfulChapterFiles: string[] = [];
  const chapterDurations: Array<{ title: string; durationMs: number }> = [];

  try {
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const outFile = chapterFile(audioDir, ch);
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
          chapter: ch,
          audioDir,
          voiceId,
          outFile,
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
          engine: "piper",
          status: "done",
        });

        successfulChapterFiles.push(outFile);
        chapterDurations.push({
          title: ch.title || `Kapitel ${ch.number}`,
          durationMs,
        });

        emit({
          phase: "audiobook.chapter.done",
          docId: doc.id,
          chapterId: ch.id,
          chapterNumber: ch.number,
          current: i + 1,
          total: chapters.length,
        });
      } catch (err) {
        upsertAudio({
          chapterId: ch.id,
          storedRelPath: relPath(outFile),
          durationMs: 0,
          voice: voiceId,
          engine: "piper",
          status: "failed",
        });
        emit({
          phase: "audiobook.chapter.failed",
          docId: doc.id,
          chapterId: ch.id,
          chapterNumber: ch.number,
          current: i + 1,
          total: chapters.length,
          message: err instanceof Error ? err.message : String(err),
        });
        console.error(`[tts] chapter ${ch.number} failed:`, err);
      }
    }

    if (successfulChapterFiles.length > 0) {
      emit({
        phase: "audiobook.book.building",
        docId: doc.id,
        message: "Baue M4B mit Kapitelmarken …",
      });
      const bookPath = join(audioDir, "book.m4b");
      try {
        await buildM4B({
          inputs: successfulChapterFiles,
          chapters: chapterDurations,
          output: bookPath,
          title: doc.title,
          coverPath: coverPathFor(doc.id),
        });
      } catch (err) {
        console.error(`[tts] M4B build failed:`, err);
      }
    }

    emit({ phase: "audiobook.done", docId: doc.id, total: chapters.length });
  } catch (err) {
    emit({
      phase: "audiobook.failed",
      docId: doc.id,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    running.delete(params.docId);
  }
}

async function synthesizeChapter(params: {
  chapter: Chapter;
  audioDir: string;
  voiceId: string;
  outFile: string;
  onChunk: (current: number, total: number) => void;
}): Promise<{ durationMs: number }> {
  const { chapter, audioDir, voiceId, outFile } = params;

  if (!chapter.text || chapter.text.trim().length < 20) {
    throw new Error("Chapter text is too short or empty.");
  }

  const tmpDir = join(audioDir, `.tmp-${chapter.id}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    const segments = segmentText(chapter.text);
    if (segments.length === 0) throw new Error("Keine Segmente aus Kapiteltext.");

    const chunkFiles: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const announcement =
        i === 0 ? chapter.title || `Kapitel ${chapter.number}` : undefined;
      const paragraphText = segments[i].paragraphs.join("\n\n");
      const plainText = announcement
        ? `${announcement}.\n\n${paragraphText}`
        : paragraphText;
      const chunkPath = join(tmpDir, `chunk-${String(i).padStart(3, "0")}.mp3`);
      await synthesizeSegmentToFile({
        text: plainText,
        voice: voiceId,
        outPath: chunkPath,
      });
      chunkFiles.push(chunkPath);
      params.onChunk(i + 1, segments.length);
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
  engine: "piper";
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

