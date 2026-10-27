// Dateien und DB-Zeilen der Hörbuch-Audios
import { randomUUID, createHash } from "crypto";
import { existsSync, readdirSync, rmSync } from "fs";
import { join, join as pathJoin } from "path";
import { db } from "../../db";
import { DATA_DIR, fromDataPath, toDataRel } from "../../paths";
import type { EngineId } from "../../tts/engines/base";
import type { Chapter } from "./state";

// 8 Zeichen Hash: Text, Stimme, Tempo, Kapitel, Index
export function chunkHash(input: {
  text: string;
  voice: string;
  rate: string;
  chapterId: string;
  index: number;
}): string {
  return createHash("sha256")
    .update(
      `${input.text}|${input.voice}|${input.rate}|${input.chapterId}|${input.index}`
    )
    .digest("hex")
    .slice(0, 8);
}


export function coverPathFor(docId: string): string | undefined {
  // pdftoppm schreibt "{base}-1.jpg"
  for (const candidate of [
    pathJoin(DATA_DIR, "covers", `${docId}-1.jpg`),
    pathJoin(DATA_DIR, "covers", `${docId}-01.jpg`),
    pathJoin(DATA_DIR, "covers", `${docId}.jpg`),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export async function documentTitle(docId: string): Promise<string> {
  const row = db().prepare("SELECT title FROM documents WHERE id = ?").get(docId) as
    | { title: string }
    | undefined;
  return row?.title ?? "PageMentor";
}

export function relPath(abs: string): string {
  return toDataRel(abs).replace(/\\/g, "/");
}

export function chapterFile(dir: string, ch: Chapter): string {
  return join(dir, `chapter-${String(ch.number).padStart(3, "0")}-${ch.id}.mp3`);
}

export function upsertAudio(params: {
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

// Audio-Zeile + MP3 eines Kapitels löschen
export function deleteAudioForChapter(chapterId: string, chapterFilePath: string): void {
  try {
    if (existsSync(chapterFilePath)) rmSync(chapterFilePath, { force: true });
  } catch {
    // best effort
  }
  db().prepare("DELETE FROM audio WHERE chapter_id = ?").run(chapterId);
}

// Alle Hörbuch-Dateien eines Dokuments löschen
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

// Ein Kapitel-Audio löschen, M4B gleich mit
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

  const fullPath = fromDataPath(row.stored_path);
  if (existsSync(fullPath)) {
    try {
      rmSync(fullPath, { force: true });
    } catch {
      // DB-Zeile wird trotzdem gelöscht
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
