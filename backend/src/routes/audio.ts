import { Hono } from "hono";
import { db } from "../db";
import { join } from "path";
import { existsSync, createReadStream, statSync } from "fs";
import { streamSSE } from "hono/streaming";
import { allVoices, findVoice, defaultVoiceFor } from "../tts/voices";
import { synthesizePreview } from "../tts/synth";
import {
  generateAudiobook,
  isGenerating,
  clearAudio,
  clearAudioForChapter,
  cancelAudiobook,
} from "../services/audiobook";
import { subscribe, getRecent } from "../services/events";
import { tt } from "../lib/i18n";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";

export const audioRoutes = new Hono();

// Voice catalog
audioRoutes.get("/voices", (c) => {
  return c.json({ voices: allVoices() });
});

// Short sample in the requested voice — played on picker click.
audioRoutes.get("/preview", async (c) => {
  const voiceId = c.req.query("voice") || "";
  const voice = findVoice(voiceId);
  if (!voice) return c.json({ error: tt(c, "err.invalidVoice") }, 400);

  const sample = voice.language === "de"
    ? "Willkommen bei PageMentor. So klingt dein Hörbuch."
    : "Welcome to PageMentor. This is how your audiobook will sound.";

  try {
    const buf = await synthesizePreview({ voice: voiceId, locale: voice.locale, text: sample });
    // Use the underlying ArrayBuffer so Response accepts it cleanly under both Bun and Node types.
    const body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : tt(c, "err.ttsFailed") }, 500);
  }
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
    .json<{ voice?: string; rate?: string }>()
    .catch(() => ({} as { voice?: string; rate?: string }));

  const doc = db().prepare("SELECT id, language FROM documents WHERE id = ?").get(docId) as
    | { id: string; language: string }
    | undefined;
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  if (isGenerating(docId)) return c.json({ status: "already-running" });

  const voiceId = body.voice || defaultVoiceFor(doc.language);
  const rate = body.rate || "+0%";

  generateAudiobook({ docId, voiceId, rate }).catch((err) =>
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

// Download the full book as M4B.
audioRoutes.get("/book/:docId", (c) => {
  const docId = c.req.param("docId");
  const fullPath = join(DATA_DIR, "audio", docId, "book.m4b");
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.notReady") }, 404);
  return serveFileWithRange(c, fullPath, "audio/mp4", "book.m4b");
});

// SSE: progress stream for pipeline + audiobook generation.
audioRoutes.get("/stream/:docId", (c) => {
  const docId = c.req.param("docId");
  return streamSSE(c, async (stream) => {
    // Replay recent events so late joiners see current state
    for (const ev of getRecent(docId)) {
      await stream.writeSSE({ event: "progress", data: JSON.stringify(ev) });
    }

    const queue: string[] = [];
    let resolver: (() => void) | null = null;
    const unsubscribe = subscribe(docId, (ev) => {
      queue.push(JSON.stringify(ev));
      if (resolver) {
        const r = resolver;
        resolver = null;
        r();
      }
    });

    try {
      while (!stream.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((r) => (resolver = r));
        }
        const payload = queue.shift();
        if (payload) await stream.writeSSE({ event: "progress", data: payload });
      }
    } finally {
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
