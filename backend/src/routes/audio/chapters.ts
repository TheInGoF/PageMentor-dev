import { introTitle } from "../../services/batch/introText";
import { Hono } from "hono";
import { join } from "path";
import { existsSync } from "fs";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { defaultVoiceFor } from "../../tts/voices";
import { generateSingleChapterAudio } from "../../services/audiobook";
import { preprocessChapterForAudio, clearAudioTextCache } from "../../services/audioPreprocess";
import { tt } from "../../lib/i18n";

export const chapterRoutes = new Hono();

// Pro Kapitel: Status → LLM-Aufbereitung → Text prüfen/bearbeiten → TTS

// Status aller Kapitel inkl. Audio, audio_text und Intro in einem Aufruf
chapterRoutes.get("/chapter-status/:docId", (c) => {
  const docId = c.req.param("docId");
  const rows = db()
    .prepare(
      `SELECT c.id as chapter_id, c.number, c.title, c.kind,
              c.start_page, c.end_page, c.sort_order,
              c.include_in_audio,
              length(c.text) as text_length,
              length(c.audio_text) as audio_text_length,
              c.audio_text_model,
              a.id as audio_id, a.duration_ms, a.voice, a.status as audio_status
       FROM chapters c
       LEFT JOIN audio a ON a.chapter_id = c.id
       WHERE c.document_id = ?
       ORDER BY c.sort_order ASC, c.number ASC`
    )
    .all(docId);
  const doc = db()
    .prepare(
      "SELECT title, doc_title, author, language, audio_intro_text FROM documents WHERE id = ?"
    )
    .get(docId) as
    | {
        title: string;
        doc_title: string | null;
        author: string | null;
        language: string;
        audio_intro_text: string | null;
      }
    | undefined;
  const introPath = join(DATA_DIR, "audio", docId, "intro.mp3");
  return c.json({
    chapters: rows,
    intro: {
      text: doc?.audio_intro_text ?? null,
      audioUrl: existsSync(introPath) ? `/api/audio/intro/${docId}/file` : null,
      // Rohdaten für den Standard-Vorschlag, den Rest baut das Frontend
      docMeta: doc
        ? {
            title: introTitle(doc.doc_title, doc.title),
            author: doc.author,
            language: doc.language,
          }
        : null,
    },
  });
});


// Alle Kapitel einer Art an- oder abwählen
chapterRoutes.patch("/include-by-kind/:docId", async (c) => {
  const docId = c.req.param("docId");
  const body = await c.req
    .json<{ kind?: string; include?: boolean | null }>()
    .catch(() => ({} as { kind?: string; include?: boolean | null }));
  if (!body.kind) return c.json({ error: tt(c, "err.missingFields") }, 400);

  const value =
    body.include === true ? 1 : body.include === false ? 0 : null;
  const result = db()
    .prepare(
      "UPDATE chapters SET include_in_audio = ? WHERE document_id = ? AND kind = ?"
    )
    .run(value, docId, body.kind);
  return c.json({ kind: body.kind, include: body.include ?? null, updated: result.changes });
});

// Kapitel ins Hörbuch aufnehmen; NULL = Standard der Kapitelart
chapterRoutes.patch("/chapter-include/:chapterId", async (c) => {
  const chapterId = c.req.param("chapterId");
  const body = await c.req
    .json<{ include?: boolean | null }>()
    .catch(() => ({} as { include?: boolean | null }));
  const exists = db()
    .prepare("SELECT id FROM chapters WHERE id = ?")
    .get(chapterId);
  if (!exists) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);

  const value =
    body.include === true ? 1 : body.include === false ? 0 : null;
  db()
    .prepare("UPDATE chapters SET include_in_audio = ? WHERE id = ?")
    .run(value, chapterId);
  return c.json({ chapterId, include: body.include ?? null });
});

// Ein Kapitel per LLM aufbereiten; force ignoriert den Cache
chapterRoutes.post("/preprocess/:chapterId", async (c) => {
  const chapterId = c.req.param("chapterId");
  const body = await c.req
    .json<{ model?: string; force?: boolean }>()
    .catch(() => ({} as { model?: string; force?: boolean }));

  const chapter = db()
    .prepare(
      "SELECT c.id, c.document_id, d.language FROM chapters c JOIN documents d ON d.id = c.document_id WHERE c.id = ?"
    )
    .get(chapterId) as { id: string; document_id: string; language: string } | undefined;
  if (!chapter) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);

  try {
    const result = await preprocessChapterForAudio({
      chapterId,
      language: chapter.language,
      model: body.model,
      force: body.force ?? false,
    });
    return c.json({
      chapterId,
      text: result.text,
      model: result.model,
      cached: result.cached,
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : tt(c, "err.ttsFailed") },
      500
    );
  }
});

// Bereinigten Text lesen, sonst Original mit cleaned: false
chapterRoutes.get("/preprocessed/:chapterId", (c) => {
  const row = db()
    .prepare(
      "SELECT id, text, audio_text, audio_text_model FROM chapters WHERE id = ?"
    )
    .get(c.req.param("chapterId")) as
    | { id: string; text: string; audio_text: string | null; audio_text_model: string | null }
    | undefined;
  if (!row) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);
  return c.json({
    chapterId: row.id,
    originalText: row.text,
    audioText: row.audio_text,
    model: row.audio_text_model,
    cleaned: !!row.audio_text,
  });
});

// Bereinigten Text von Hand ändern, leer = Cache leeren
chapterRoutes.patch("/preprocessed/:chapterId", async (c) => {
  const chapterId = c.req.param("chapterId");
  const body = await c.req
    .json<{ text?: string | null }>()
    .catch(() => ({} as { text?: string | null }));

  const exists = db()
    .prepare("SELECT id FROM chapters WHERE id = ?")
    .get(chapterId);
  if (!exists) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);

  if (body.text == null || body.text.trim().length === 0) {
    clearAudioTextCache(chapterId);
    return c.json({ chapterId, cleared: true });
  }

  db()
    .prepare(
    // Eigener Modellname markiert Handarbeit für die UI
      "UPDATE chapters SET audio_text = ?, audio_text_model = ? WHERE id = ?"
    )
    .run(body.text.trim(), "manual-edit", chapterId);
  return c.json({ chapterId, saved: true, length: body.text.trim().length });
});

// TTS für ein Kapitel, ohne LLM-Lauf: Nutzer prüft den Text vorher
chapterRoutes.post("/generate-chapter/:chapterId", async (c) => {
  const chapterId = c.req.param("chapterId");
  const body = await c.req
    .json<{ voice?: string; rate?: string }>()
    .catch(() => ({} as { voice?: string; rate?: string }));

  const chapter = db()
    .prepare(
      "SELECT c.id, c.document_id, d.language FROM chapters c JOIN documents d ON d.id = c.document_id WHERE c.id = ?"
    )
    .get(chapterId) as { id: string; document_id: string; language: string } | undefined;
  if (!chapter) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);

  const voiceId = body.voice || defaultVoiceFor(chapter.language);
  if (!voiceId) return c.json({ error: "No voice available." }, 400);

  // Ohne Warten, die UI folgt per SSE
  generateSingleChapterAudio({
    chapterId,
    voiceId,
    rate: body.rate,
  }).catch((err) => console.error(`[tts] single-chapter failed:`, err));

  return c.json({ status: "queued", chapterId, voice: voiceId });
});
