// M4B neu bauen aus vorhandenen Kapitel-MP3s
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { buildM4B, probeDurationMs } from "../../tts/ffmpeg";
import { ensureCover } from "../covers";
import { emit } from "../events";
import { pickLang, tLang, chapterLabel } from "../../lib/i18n";
import type { Document } from "./state";

// M4B aus allen fertigen Kapitel-MP3s bauen
export async function rebuildM4B(docId: string): Promise<{
  path: string;
  chapters: number;
}> {
  const d = db();
  const doc = d
    .prepare(
      `SELECT d.id, d.title, d.doc_title, d.author, d.short_code, d.series_sequence, d.language,
              m.name AS module_name
       FROM documents d
       LEFT JOIN modules m ON m.id = d.module_id
       WHERE d.id = ?`
    )
    .get(docId) as Document | undefined;
  if (!doc) throw new Error("Document not found");

  const audioDir = join(DATA_DIR, "audio", docId);
  mkdirSync(audioDir, { recursive: true });

  // Fertige Audios in Kapitel-Reihenfolge
  const rows = d
    .prepare(
      `SELECT a.stored_path, c.title, a.duration_ms, c.number, c.sort_order
       FROM audio a
       JOIN chapters c ON c.id = a.chapter_id
       WHERE c.document_id = ? AND a.status = 'done'
       ORDER BY c.sort_order ASC, c.number ASC`
    )
    .all(docId) as Array<{
    stored_path: string;
    title: string | null;
    duration_ms: number;
    number: number;
    sort_order: number;
  }>;

  const lang = pickLang(doc.language);

  if (rows.length === 0) {
    throw new Error(tLang(lang, "err.noFinishedAudio"));
  }

  const inputs: string[] = [];
  const m4bChapters: Array<{ title: string; durationMs: number }> = [];

  const introPath = join(audioDir, "intro.mp3");
  if (existsSync(introPath)) {
    // Echte Dauer nötig, sonst verrutschen die Kapitelmarken
    const introMs = await probeDurationMs(introPath).catch(() => 0);
    inputs.push(introPath);
    m4bChapters.push({
      title: tLang(lang, "label.intro"),
      durationMs: introMs,
    });
  }

  for (const r of rows) {
    const full = join(DATA_DIR, r.stored_path);
    if (!existsSync(full)) continue;
    inputs.push(full);
    m4bChapters.push({
      title: r.title || chapterLabel(lang, r.number),
      durationMs: r.duration_ms,
    });
  }

  if (inputs.length === 0) {
    throw new Error(tLang(lang, "err.allAudioMissing"));
  }

  const bookPath = join(audioDir, "book.m4b");
  let lastRebuildEmit = 0;
  await buildM4B({
    inputs,
    chapters: m4bChapters,
    output: bookPath,
    title: doc.title || doc.doc_title || "",
    artist: doc.author ?? undefined,
    shortCode: doc.short_code ?? undefined,
    series: doc.module_name ?? undefined,
    seriesSequence: doc.series_sequence ?? undefined,
    coverPath: await ensureCover(doc.id),
    onProgress: (currentMs, totalMs) => {
      const now = Date.now();
      if (now - lastRebuildEmit < 500 && currentMs < totalMs) return;
      lastRebuildEmit = now;
      emit({
        phase:
          currentMs === 0
            ? "audiobook.m4b.start"
            : "audiobook.m4b.progress",
        docId,
        current: currentMs,
        total: totalMs,
      });
    },
  });
  emit({
    phase: "audiobook.m4b.done",
    docId,
    current: 1,
    total: 1,
  });

  return { path: bookPath, chapters: m4bChapters.length };
}
