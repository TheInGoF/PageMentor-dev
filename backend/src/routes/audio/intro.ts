import { Hono } from "hono";
import { join } from "path";
import { existsSync } from "fs";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { defaultVoiceFor } from "../../tts/voices";
import { generateIntroAudio } from "../../services/audiobook";
import { preprocessIntroForAudio, clearAudioIntroTtsCache } from "../../services/audioPreprocess";
import { tt } from "../../lib/i18n";
import { serveFileWithRange } from "./files";

export const introRoutes = new Hono();

// Intro-Text setzen
// audio_intro_text = Rohtext, audio_intro_text_tts = phonetisch für TTS
// Änderung am Rohtext leert den TTS-Cache
introRoutes.put("/intro/:docId", async (c) => {
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

// Intro durch Gemma, Ergebnis cachen; force ignoriert den Cache
introRoutes.post("/intro/:docId/preprocess", async (c) => {
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

// Bereinigtes Intro lesen, sonst Rohtext mit cleaned: false
introRoutes.get("/intro/:docId/preprocessed", (c) => {
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

// Bereinigtes Intro von Hand ändern, leer = Cache leeren
introRoutes.patch("/intro/:docId/preprocessed", async (c) => {
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

// Intro-MP3 erzeugen, immer aus der phonetischen Fassung
// Fehlt sie: Gemma jetzt laufen lassen
introRoutes.post("/intro/:docId/generate", async (c) => {
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
      // Ohne Gemma: Rohtext, Name evtl. falsch ausgesprochen
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

// Intro-MP3 streamen, mit HTTP Range
introRoutes.get("/intro/:docId/file", (c) => {
  const docId = c.req.param("docId");
  const fullPath = join(DATA_DIR, "audio", docId, "intro.mp3");
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.notReady") }, 404);
  return serveFileWithRange(c, fullPath, "audio/mpeg");
});

// Intro-MP3 löschen, Text bleibt
introRoutes.delete("/intro/:docId/file", (c) => {
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
