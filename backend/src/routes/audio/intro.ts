import { Hono } from "hono";
import { existsSync, rmSync } from "fs";
import { db } from "../../db";
import { defaultVoiceFor } from "../../tts/voices";
import { generateIntroAudio } from "../../services/audiobook";
import { preprocessIntroForAudio, clearAudioIntroTtsCache } from "../../services/audioPreprocess";
import { introTtsText } from "../../services/audiobook/intro";
import { getIntro, introAudioPath, parseVariant, setIntroText, setIntroTts } from "../../services/audiobook/introStore";
import { learnSettings, listUnits } from "../../services/learnbook/store";
import { startLearnIntro } from "../../services/learnbook/run";
import { tt } from "../../lib/i18n";
import { serveFileWithRange } from "./files";

// Intro der drei Hörbuch-Arten; ?v=subject|language wählt ein Lernhörbuch, ohne ist es das Original-Hörbuch.
// Ablauf überall gleich: Text → Gemma-Sprachfassung (ansehen, ändern, zurücksetzen) → MP3 (anhören, löschen)
export const introRoutes = new Hono();

const exists = (docId: string) => !!db().prepare("SELECT id FROM documents WHERE id = ?").get(docId);

// Intro-Text setzen; Änderung am Text leert die Sprachfassung. Beim Lernhörbuch heißt leer: Vorlage
introRoutes.put("/intro/:docId", async (c) => {
  const docId = c.req.param("docId");
  const v = parseVariant(c.req.query("v"));
  const body = await c.req.json<{ text?: string | null }>().catch(() => ({} as { text?: string | null }));
  if (!exists(docId)) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  return c.json({ docId, text: setIntroText(docId, v, body.text ?? null) });
});

// Intro durch Gemma, Ergebnis cachen; force ignoriert den Cache
introRoutes.post("/intro/:docId/preprocess", async (c) => {
  const docId = c.req.param("docId");
  const variant = parseVariant(c.req.query("v"));
  const body = await c.req.json<{ model?: string; force?: boolean }>().catch(() => ({} as { model?: string; force?: boolean }));
  try {
    const result = await preprocessIntroForAudio({ docId, model: body.model, force: body.force ?? false, variant });
    return c.json({ docId, text: result.text, model: result.model, cached: result.cached });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : tt(c, "err.ttsFailed") }, 500);
  }
});

// Sprachfassung lesen, sonst Text mit cleaned: false
introRoutes.get("/intro/:docId/preprocessed", (c) => {
  const docId = c.req.param("docId");
  const intro = getIntro(docId, parseVariant(c.req.query("v")));
  if (!intro) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  return c.json({ docId, originalText: intro.text ?? "", audioText: intro.tts, model: intro.ttsModel, cleaned: !!intro.tts });
});

// Sprachfassung von Hand ändern, leer = zurücksetzen (Gemma fragt beim nächsten Mal neu)
introRoutes.patch("/intro/:docId/preprocessed", async (c) => {
  const docId = c.req.param("docId");
  const v = parseVariant(c.req.query("v"));
  const body = await c.req.json<{ text?: string | null }>().catch(() => ({} as { text?: string | null }));
  if (!exists(docId)) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  if (body.text == null || body.text.trim().length === 0) {
    clearAudioIntroTtsCache(docId, v);
    return c.json({ docId, cleared: true });
  }
  setIntroTts(docId, v, body.text.trim(), "manual-edit", null);
  return c.json({ docId, saved: true, length: body.text.trim().length });
});

// MP3 erzeugen, immer aus der Sprachfassung (fehlt sie, läuft Gemma jetzt).
// Lernhörbuch: über seine Warteschlange mit seiner Stimme; danach wird das M4B mit dem neuen Intro neu gebaut
introRoutes.post("/intro/:docId/generate", async (c) => {
  const docId = c.req.param("docId");
  const v = parseVariant(c.req.query("v"));
  const body = await c.req.json<{ voice?: string; rate?: string; model?: string }>().catch(() => ({} as { voice?: string; rate?: string; model?: string }));
  const intro = getIntro(docId, v);
  if (!intro) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  if (!intro.text?.trim()) return c.json({ error: "Intro text is empty" }, 400);

  if (v !== "original") {
    if (learnSettings(docId).kind !== v) return c.json({ error: "Das Heft hat gerade die andere Lernhörbuch-Art" }, 400);
    if (!listUnits(docId).some((u) => u.script && !u.skip_reason)) return c.json({ error: "Noch keine Einheiten mit Skript" }, 400);
    startLearnIntro(docId, body.rate || "+0%", body.voice || undefined);
    return c.json({ status: "queued", docId });
  }

  const language = (db().prepare("SELECT language FROM documents WHERE id = ?").get(docId) as { language: string }).language;
  const voiceId = body.voice || defaultVoiceFor(language);
  if (!voiceId) return c.json({ error: "No voice available" }, 400);
  const ttsText = (await introTtsText(docId, body.model)) ?? intro.text;
  generateIntroAudio({ docId, text: ttsText, voiceId, rate: body.rate }).catch((err) => console.error(`[tts] intro generation failed:`, err));
  return c.json({ status: "queued", docId, voice: voiceId });
});

// MP3 streamen, mit HTTP Range
introRoutes.get("/intro/:docId/file", (c) => {
  const fullPath = introAudioPath(c.req.param("docId"), parseVariant(c.req.query("v")));
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.notReady") }, 404);
  return serveFileWithRange(c, fullPath, "audio/mpeg");
});

// MP3 löschen, Text bleibt
introRoutes.delete("/intro/:docId/file", (c) => {
  const fullPath = introAudioPath(c.req.param("docId"), parseVariant(c.req.query("v")));
  for (const p of [fullPath, `${fullPath}.json`]) {
    try {
      if (existsSync(p)) rmSync(p, { force: true });
    } catch {
      /* best effort */
    }
  }
  return c.json({ status: "ok" });
});
