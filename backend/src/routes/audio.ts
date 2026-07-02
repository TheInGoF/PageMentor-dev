import { Hono } from "hono";
import { db } from "../db";
import { join } from "path";
import { existsSync, createReadStream, statSync } from "fs";
import { streamSSE } from "hono/streaming";
import { allVoices, findVoice, defaultVoiceFor } from "../tts/voices";
import { synthesizePreview } from "../tts/synth";
import {
  generateAudiobook,
  generateSingleChapterAudio,
  generateIntroAudio,
  isGenerating,
  getRunProgress,
  clearAudio,
  clearAudioForChapter,
  cancelAudiobook,
  rebuildM4B,
} from "../services/audiobook";
import {
  preprocessChapterForAudio,
  clearAudioTextCache,
  preprocessIntroForAudio,
  clearAudioIntroTtsCache,
} from "../services/audioPreprocess";
import { subscribe, getRecent } from "../services/events";
import { tt } from "../lib/i18n";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";

export const audioRoutes = new Hono();

// Voice catalog. By default returns only voices flagged
// `showInAudiobook=true` (so the audiobook tab's voice picker stays
// readable). The Settings page passes `?showHidden=1` to also list
// the ones the user has hidden — needed so toggles can flip them
// back to visible.
audioRoutes.get("/voices", (c) => {
  const showHidden = c.req.query("showHidden") === "1";
  return c.json({ voices: allVoices(showHidden) });
});

// Short sample in the requested voice — played on picker click.
// Optional query params let the settings preset tester request a
// tailored preview with custom text and not-yet-saved instruction:
//   /api/audio/preview?voice=preset:Ryan&text=...&instruct=...
// With overrides we disable the 24h cache (otherwise the user sees
// old tests when they tweak the text).
audioRoutes.get("/preview", async (c) => {
  const voiceId = c.req.query("voice") || "";
  const voice = findVoice(voiceId);
  if (!voice) return c.json({ error: tt(c, "err.invalidVoice") }, 400);

  const textOverride = c.req.query("text");
  const instructOverride = c.req.query("instruct");
  const tempOverride = c.req.query("temperature");
  const topPOverride = c.req.query("top_p");
  const topKOverride = c.req.query("top_k");
  const repPenOverride = c.req.query("repetition_penalty");
  const hasOverrides =
    textOverride !== undefined ||
    instructOverride !== undefined ||
    tempOverride !== undefined ||
    topPOverride !== undefined ||
    topKOverride !== undefined ||
    repPenOverride !== undefined;

  // Longer sample text: Qwen-TTS drifts autoregressively — the first
  // ~5 seconds sound consistent with the instruction prompt, after
  // which the voice can fall back toward the training distribution.
  // A 50-character sample wouldn't show this drift; an audiobook
  // chunk would. So we use a ~380-character paragraph here so the
  // preview is representative of the later audiobook output.
  const sample = textOverride
    ? textOverride
    : voice.language === "de"
    ? "Willkommen bei PageMentor. So klingt dein Hörbuch. Der Text geht bewusst über mehrere Sätze, damit Sie einschätzen können, wie die Stimme über einen längeren Absatz hinweg klingt. Gerade bei einem Hörbuch kommt es darauf an, dass die Aussprache stabil bleibt und der Klangcharakter sich nicht mitten im Absatz verändert."
    : "Welcome to PageMentor. This is how your audiobook will sound. The text deliberately spans several sentences so you can judge how this voice sounds across a longer passage. Audiobook listening depends on the voice staying stable without shifting character mid-paragraph.";

  const parseOptFloat = (s: string | undefined): number | undefined => {
    if (s === undefined || s === "") return undefined;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const parseOptInt = (s: string | undefined): number | undefined => {
    if (s === undefined || s === "") return undefined;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  try {
    const buf = await synthesizePreview({
      voice: voiceId,
      locale: voice.locale,
      text: sample,
      instructOverride,
      temperatureOverride: parseOptFloat(tempOverride),
      topPOverride: parseOptFloat(topPOverride),
      topKOverride: parseOptInt(topKOverride),
      repetitionPenaltyOverride: parseOptFloat(repPenOverride),
    });
    // Use the underlying ArrayBuffer so Response accepts it cleanly under both Bun and Node types.
    const body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": hasOverrides ? "no-store" : "public, max-age=86400",
      },
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : tt(c, "err.ttsFailed") }, 500);
  }
});

// --- Per-chapter workflow ---------------------------------------------
//
// Granular control so the user can decide per chapter whether/how
// Ollama cleans and when TTS runs. Flow in the UI:
//   1. GET /chapter-status/:docId   → current state of all chapters
//   2. POST /preprocess/:chapterId  → Ollama clean (this chapter only)
//   3. GET /preprocessed/:chapterId → show cleaned text
//   4. PATCH /preprocessed/:chapterId → manual edit
//   5. POST /generate-chapter/:chapterId → TTS for that one chapter

// Unified per-chapter status — combines chapters + audio +
// audio_text so the UI gets everything from one call. Also returns
// the doc-level intro (audio_intro_text + an existing intro.mp3).
audioRoutes.get("/chapter-status/:docId", (c) => {
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
      // Raw metadata for the default suggestion in the frontend. The
      // frontend builds the detailed default itself because it also
      // knows model + voice (frontend state) — we don't want to pass
      // those back and forth to the backend.
      docMeta: doc
        ? {
            title: doc.doc_title || doc.title,
            author: doc.author,
            language: doc.language,
          }
        : null,
    },
  });
});

// Set / read / delete intro text. The intro lives in two columns:
//   audio_intro_text     -> human-readable raw text the user edits
//   audio_intro_text_tts -> Gemma-cleaned phonetic version for TTS
// Edits to the raw text invalidate the cached TTS version so the next
// generate call runs Gemma fresh.
audioRoutes.put("/intro/:docId", async (c) => {
  const docId = c.req.param("docId");
  const body = await c.req
    .json<{ text?: string | null }>()
    .catch(() => ({} as { text?: string | null }));
  const exists = db()
    .prepare("SELECT id FROM documents WHERE id = ?")
    .get(docId);
  if (!exists) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  const value =
    body.text == null || body.text.trim().length === 0
      ? null
      : body.text.trim();
  db()
    .prepare(
      "UPDATE documents SET audio_intro_text = ?, audio_intro_text_tts = NULL, audio_intro_text_tts_model = NULL WHERE id = ?"
    )
    .run(value, docId);
  return c.json({ docId, text: value });
});

// Run Gemma on the current intro and cache the phonetic version.
// `force=true` ignores the cache.
audioRoutes.post("/intro/:docId/preprocess", async (c) => {
  const docId = c.req.param("docId");
  const body = await c.req
    .json<{ model?: string; force?: boolean }>()
    .catch(() => ({} as { model?: string; force?: boolean }));

  try {
    const result = await preprocessIntroForAudio({
      docId,
      model: body.model,
      force: body.force ?? false,
    });
    return c.json({
      docId,
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

// Read the cleaned intro — if there isn't one yet, returns the raw
// text with `cleaned: false` so the frontend has something to show.
audioRoutes.get("/intro/:docId/preprocessed", (c) => {
  const row = db()
    .prepare(
      "SELECT id, audio_intro_text, audio_intro_text_tts, audio_intro_text_tts_model FROM documents WHERE id = ?"
    )
    .get(c.req.param("docId")) as
    | {
        id: string;
        audio_intro_text: string | null;
        audio_intro_text_tts: string | null;
        audio_intro_text_tts_model: string | null;
      }
    | undefined;
  if (!row) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  return c.json({
    docId: row.id,
    originalText: row.audio_intro_text ?? "",
    audioText: row.audio_intro_text_tts,
    model: row.audio_intro_text_tts_model,
    cleaned: !!row.audio_intro_text_tts,
  });
});

// Manual edit of the cleaned intro. Empty / null clears the cache so
// the next preprocess call runs Gemma again.
audioRoutes.patch("/intro/:docId/preprocessed", async (c) => {
  const docId = c.req.param("docId");
  const body = await c.req
    .json<{ text?: string | null }>()
    .catch(() => ({} as { text?: string | null }));
  const exists = db()
    .prepare("SELECT id FROM documents WHERE id = ?")
    .get(docId);
  if (!exists) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  if (body.text == null || body.text.trim().length === 0) {
    clearAudioIntroTtsCache(docId);
    return c.json({ docId, cleared: true });
  }
  db()
    .prepare(
      "UPDATE documents SET audio_intro_text_tts = ?, audio_intro_text_tts_model = ? WHERE id = ?"
    )
    .run(body.text.trim(), "manual-edit", docId);
  return c.json({ docId, saved: true, length: body.text.trim().length });
});

// Generate intro MP3. Uses the cached TTS version when present —
// otherwise runs Gemma on the fly so the audio always comes out of
// the phonetic variant, never the raw "Qwen3-TTS"/"PageMentor" form.
audioRoutes.post("/intro/:docId/generate", async (c) => {
  const docId = c.req.param("docId");
  const body = await c.req
    .json<{ voice?: string; rate?: string; model?: string }>()
    .catch(() => ({} as { voice?: string; rate?: string; model?: string }));

  const doc = db()
    .prepare(
      "SELECT id, language, audio_intro_text, audio_intro_text_tts FROM documents WHERE id = ?"
    )
    .get(docId) as
    | {
        id: string;
        language: string;
        audio_intro_text: string | null;
        audio_intro_text_tts: string | null;
      }
    | undefined;
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  if (!doc.audio_intro_text || doc.audio_intro_text.trim().length === 0) {
    return c.json({ error: "Intro text is empty" }, 400);
  }
  const voiceId = body.voice || defaultVoiceFor(doc.language);
  if (!voiceId) return c.json({ error: "No voice available" }, 400);

  let ttsText = doc.audio_intro_text_tts;
  if (!ttsText || ttsText.trim().length === 0) {
    try {
      const pre = await preprocessIntroForAudio({
        docId,
        model: body.model,
      });
      ttsText = pre.text;
    } catch (err) {
      // Gemma not available or failed — fall back to the raw text so
      // the user at least gets audio, even if the model name is
      // mispronounced. We log so the failure isn't silent.
      console.warn(
        `[tts] intro preprocess failed, falling back to raw text:`,
        err instanceof Error ? err.message : err
      );
      ttsText = doc.audio_intro_text;
    }
  }

  generateIntroAudio({
    docId,
    text: ttsText,
    voiceId,
    rate: body.rate,
  }).catch((err) => console.error(`[tts] intro generation failed:`, err));

  return c.json({ status: "queued", docId, voice: voiceId });
});

// Stream intro MP3 (HTTP Range, like chapter files).
audioRoutes.get("/intro/:docId/file", (c) => {
  const docId = c.req.param("docId");
  const fullPath = join(DATA_DIR, "audio", docId, "intro.mp3");
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.notReady") }, 404);
  return serveFileWithRange(c, fullPath, "audio/mpeg");
});

// Delete intro MP3 (text remains — user may want to regenerate).
audioRoutes.delete("/intro/:docId/file", (c) => {
  const docId = c.req.param("docId");
  const fullPath = join(DATA_DIR, "audio", docId, "intro.mp3");
  if (existsSync(fullPath)) {
    try {
      const { rmSync } = require("fs");
      rmSync(fullPath, { force: true });
    } catch {
      /* best effort */
    }
  }
  return c.json({ status: "ok" });
});

// Bulk toggle of all chapters of a kind. UI uses this for
// "include all examples" / "exclude all exercises" etc.
audioRoutes.patch("/include-by-kind/:docId", async (c) => {
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

// Toggle whether a chapter goes into the audiobook. NULL as value =
// "use default for this kind" (matches the initial state before
// v1.14.001).
audioRoutes.patch("/chapter-include/:chapterId", async (c) => {
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

// Clean up a single chapter via Ollama. `force=true` ignores the
// cache and regenerates (e.g. after model change).
audioRoutes.post("/preprocess/:chapterId", async (c) => {
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

// Read the cleaned text — if there isn't one yet, the original text
// is returned with `cleaned: false`.
audioRoutes.get("/preprocessed/:chapterId", (c) => {
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

// Manual edit of the cleaned text. Empty string or null → clear
// cache (next preprocess will trigger Ollama again).
audioRoutes.patch("/preprocessed/:chapterId", async (c) => {
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
      // We mark manual edits with a dedicated model string so the
      // UI can show the "human-curated" status.
      "UPDATE chapters SET audio_text = ?, audio_text_model = ? WHERE id = ?"
    )
    .run(body.text.trim(), "manual-edit", chapterId);
  return c.json({ chapterId, saved: true, length: body.text.trim().length });
});

// TTS for a single chapter. Uses audio_text if present, otherwise text.
// NO preprocessing here — the user should consciously decide when
// Ollama runs (so they can review the text first).
audioRoutes.post("/generate-chapter/:chapterId", async (c) => {
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

  // Fire-and-forget, the UI observes SSE as before.
  generateSingleChapterAudio({
    chapterId,
    voiceId,
    rate: body.rate,
  }).catch((err) => console.error(`[tts] single-chapter failed:`, err));

  return c.json({ status: "queued", chapterId, voice: voiceId });
});

// List audio files for a document's chapters
audioRoutes.get("/document/:docId", (c) => {
  const rows = db()
    .prepare(
      `SELECT a.id, a.chapter_id, a.stored_path, a.duration_ms, a.engine, a.voice, a.status,
              c.title as chapter_title, c.number as chapter_number
       FROM audio a
       JOIN chapters c ON c.id = a.chapter_id
       WHERE c.document_id = ?
       ORDER BY c.sort_order ASC, c.number ASC`
    )
    .all(c.req.param("docId"));
  const docId = c.req.param("docId");
  const m4bPath = join(DATA_DIR, "audio", docId, "book.m4b");
  return c.json({
    audio: rows,
    book: existsSync(m4bPath) ? { url: `/api/audio/book/${docId}` } : null,
    generating: isGenerating(docId),
  });
});

// Kick off audiobook generation.
audioRoutes.post("/generate/:docId", async (c) => {
  const docId = c.req.param("docId");
  const body = await c.req
    .json<{ voice?: string; rate?: string; model?: string }>()
    .catch(() => ({} as { voice?: string; rate?: string; model?: string }));

  const doc = db().prepare("SELECT id, language FROM documents WHERE id = ?").get(docId) as
    | { id: string; language: string }
    | undefined;
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  if (isGenerating(docId)) return c.json({ status: "already-running" });

  const voiceId = body.voice || defaultVoiceFor(doc.language);
  const rate = body.rate || "+0%";

  generateAudiobook({ docId, voiceId, rate, model: body.model }).catch((err) =>
    console.error("[tts] audiobook failed:", err)
  );

  return c.json({ status: "queued", voice: voiceId });
});

// Clear all audio for a document. Deletes regardless of in-memory
// generating state — the running worker (if any) will fail on the
// next file write, which is the desired behaviour when the user wants
// to abort + regenerate from scratch.
audioRoutes.delete("/document/:docId", (c) => {
  const docId = c.req.param("docId");
  clearAudio(docId);
  return c.json({ status: "ok" });
});

// Clear a single chapter's audio (file + DB row). The combined M4B is
// invalidated too — the user needs to regenerate to get a new book.
audioRoutes.delete("/chapter/:audioId", (c) => {
  const ok = clearAudioForChapter(c.req.param("audioId"));
  if (!ok) return c.json({ error: tt(c, "err.notReady") }, 404);
  return c.json({ status: "ok" });
});

// Cancel an in-progress audiobook generation. Chapters already finished
// remain in place; the worker stops before the next chunk.
audioRoutes.post("/cancel/:docId", (c) => {
  const ok = cancelAudiobook(c.req.param("docId"));
  return c.json({ status: ok ? "canceling" : "not-running" });
});

// Snapshot of the current in-memory run state for frontend rehydration
// after a page reload. Returns 404 when no generation is active.
audioRoutes.get("/progress/:docId", (c) => {
  const snap = getRunProgress(c.req.param("docId"));
  if (!snap) return c.json({ running: false });
  return c.json({ running: true, ...snap });
});

// Builds an M4B from all already-finished chapter MP3s + intro.
// Needed when the user generated per-chapter and afterwards wants a
// full download (a full-book run builds the M4B automatically).
audioRoutes.post("/rebuild-m4b/:docId", async (c) => {
  const docId = c.req.param("docId");
  try {
    const res = await rebuildM4B(docId);
    return c.json({ ok: true, chapters: res.chapters });
  } catch (e) {
    const msg = (e as Error).message || "rebuildM4B failed (empty error)";
    // Log server-side fully — otherwise the NAS log only shows the
    // `[m4b] build ...` start line and the exception was silent.
    console.error(`[rebuild-m4b] ${docId} failed:`, e);
    return c.json({ error: msg }, 400);
  }
});

// Stream a chapter MP3 with HTTP Range support (for seek/scrub).
audioRoutes.get("/file/:audioId", (c) => {
  const row = db().prepare("SELECT stored_path, status FROM audio WHERE id = ?").get(c.req.param("audioId")) as
    | { stored_path: string; status: string }
    | undefined;
  if (!row || row.status !== "done") return c.json({ error: tt(c, "err.notReady") }, 404);

  const fullPath = join(DATA_DIR, row.stored_path);
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.fileMissing") }, 404);

  return serveFileWithRange(c, fullPath, "audio/mpeg");
});

// Download the full book as M4B. The filename the browser offers
// the user on download is derived from the document title —
// otherwise the user would end up with X anonymous "book.m4b"
// files in their download folder. The on-disk path stays stable.
audioRoutes.get("/book/:docId", (c) => {
  const docId = c.req.param("docId");
  const fullPath = join(DATA_DIR, "audio", docId, "book.m4b");
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.notReady") }, 404);
  const doc = db()
    .prepare(
      "SELECT title, doc_title, author, short_code FROM documents WHERE id = ?"
    )
    .get(docId) as
    | {
        title: string;
        doc_title: string | null;
        author: string | null;
        short_code: string | null;
      }
    | undefined;
  const baseTitle = doc?.doc_title?.trim() || doc?.title || "audiobook";
  // Filename segments: shortcode_author_title — empty segments are
  // skipped so we don't end up with double underscores.
  const parts = [
    doc?.short_code?.trim(),
    doc?.author?.trim(),
    baseTitle,
  ]
    .map((s) => (s ? safeFilename(s) : ""))
    .filter((s) => s.length > 0);
  const downloadName = `${parts.join("_")}.m4b`;
  return serveFileWithRange(c, fullPath, "audio/mp4", downloadName);
});

/** Makes any doc title filesystem-/header-safe:
 *  - expand German umlauts + ß (Safari/IE don't like raw bytes in
 *    Content-Disposition)
 *  - replace anything but letters/digits/dash/space with _
 *  - collapse multiple spaces, trim
 *  - cap at 120 characters (some FS have 255-byte limits and UTF-8
 *    expansion eats the buffer)
 */
function safeFilename(s: string): string {
  return s
    .replace(/ä/g, "ae").replace(/Ä/g, "Ae")
    .replace(/ö/g, "oe").replace(/Ö/g, "Oe")
    .replace(/ü/g, "ue").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}\- ]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "audiobook";
}

// SSE: progress stream for pipeline + audiobook generation.
audioRoutes.get("/stream/:docId", (c) => {
  const docId = c.req.param("docId");
  return streamSSE(c, async (stream) => {
    const queue: string[] = [];
    let resolver: (() => void) | null = null;
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

    const wake = () => {
      if (resolver) {
        const r = resolver;
        resolver = null;
        r();
      }
    };

    // Subscribe FIRST, replay afterwards: events emitted while the
    // replay writes are awaited would otherwise be lost (neither in
    // the snapshot nor delivered) — a client connecting mid-run could
    // permanently miss e.g. audiobook.chapter.done.
    const unsubscribe = subscribe(docId, (ev) => {
      queue.push(JSON.stringify(ev));
      wake();
    });

    // Replay recent events so late joiners see current state.
    for (const ev of getRecent(docId)) {
      await stream.writeSSE({ event: "progress", data: JSON.stringify(ev) });
    }

    // Keep-alive every 20 s. Without it every proxy (nginx default
    // 60 s, cloudflare 100 s) and some browsers close the idle
    // HTTP/2 connection — EventSource then reconnects constantly
    // and the client sees ERR_HTTP2_PROTOCOL_ERROR in the console.
    // SSE comments (`:` prefix) are silently dropped by the
    // EventSource client but keep the TCP connection warm. The timer
    // ALSO wakes the main loop: when the client disconnects while no
    // events arrive, the loop would otherwise block on its promise
    // forever and leak the subscription + this interval.
    keepAliveTimer = setInterval(() => {
      if (stream.aborted) {
        wake();
        return;
      }
      stream.write(": keepalive\n\n").catch(() => {
        // client gone — the wake() below lets the main loop exit
      });
      wake();
    }, 20_000);

    try {
      while (!stream.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((r) => (resolver = r));
          if (stream.aborted) break;
        }
        const payload = queue.shift();
        if (payload) await stream.writeSSE({ event: "progress", data: payload });
      }
    } finally {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      unsubscribe();
    }
  });
});

function serveFileWithRange(c: any, fullPath: string, mime: string, download?: string): Response {
  const stat = statSync(fullPath);
  const range = c.req.header("range");

  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download}"`;

  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start < stat.size && end >= start && end < stat.size) {
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
        headers["Content-Length"] = String(end - start + 1);
        // @ts-ignore — Node streams are compatible with Fetch Response bodies in Bun
        const body = createReadStream(fullPath, { start, end });
        return new Response(body as any, { status: 206, headers });
      }
    }
  }

  headers["Content-Length"] = String(stat.size);
  // @ts-ignore
  const body = createReadStream(fullPath);
  return new Response(body as any, { status: 200, headers });
}
