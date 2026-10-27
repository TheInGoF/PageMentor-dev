import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { join } from "path";
import { existsSync } from "fs";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { defaultVoiceFor } from "../../tts/voices";
import {
  generateAudiobook,
  isGenerating,
  getRunProgress,
  clearAudio,
  clearAudioForChapter,
  cancelAudiobook,
  rebuildM4B,
} from "../../services/audiobook";
import { subscribe, getRecent } from "../../services/events";
import { tt } from "../../lib/i18n";

export const bookRoutes = new Hono();

// Audios der Kapitel eines Dokuments
bookRoutes.get("/document/:docId", (c) => {
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

// Hörbuch-Erzeugung starten
bookRoutes.post("/generate/:docId", async (c) => {
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

// Alle Audios eines Dokuments löschen, auch während eines Laufs
bookRoutes.delete("/document/:docId", (c) => {
  const docId = c.req.param("docId");
  clearAudio(docId);
  return c.json({ status: "ok" });
});

// Ein Kapitel-Audio löschen, M4B wird ungültig
bookRoutes.delete("/chapter/:audioId", (c) => {
  const ok = clearAudioForChapter(c.req.param("audioId"));
  if (!ok) return c.json({ error: tt(c, "err.notReady") }, 404);
  return c.json({ status: "ok" });
});

// Laufende Erzeugung abbrechen, fertige Kapitel bleiben
bookRoutes.post("/cancel/:docId", (c) => {
  const ok = cancelAudiobook(c.req.param("docId"));
  return c.json({ status: ok ? "canceling" : "not-running" });
});

// Laufzustand für das Frontend nach Reload, 404 ohne Lauf
bookRoutes.get("/progress/:docId", (c) => {
  const snap = getRunProgress(c.req.param("docId"));
  if (!snap) return c.json({ running: false });
  return c.json({ running: true, ...snap });
});

// M4B aus fertigen Kapitel-MP3s + Intro bauen
bookRoutes.post("/rebuild-m4b/:docId", async (c) => {
  const docId = c.req.param("docId");
  try {
    const res = await rebuildM4B(docId);
    return c.json({ ok: true, chapters: res.chapters });
  } catch (e) {
    const msg = (e as Error).message || "rebuildM4B failed (empty error)";
    // Voll loggen, sonst ist der Fehler stumm
    console.error(`[rebuild-m4b] ${docId} failed:`, e);
    return c.json({ error: msg }, 400);
  }
});


// SSE: Fortschritt von Pipeline und Hörbuch
bookRoutes.get("/stream/:docId", (c) => {
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

    // Erst abonnieren, dann Verlauf senden: sonst gehen Events verloren
    const unsubscribe = subscribe(docId, (ev) => {
      queue.push(JSON.stringify(ev));
      wake();
    });

    // Letzte Events nachliefern
    for (const ev of getRecent(docId)) {
      await stream.writeSSE({ event: "progress", data: JSON.stringify(ev) });
    }

    // Keep-alive alle 20 s, sonst schließen Proxys die Verbindung
    // Weckt auch die Schleife, wenn der Client weg ist
    keepAliveTimer = setInterval(() => {
      if (stream.aborted) {
        wake();
        return;
      }
      stream.write(": keepalive\n\n").catch(() => {
        // Client weg, wake() beendet die Schleife
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
