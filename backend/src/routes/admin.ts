/**
 * Admin routes — for UI actions tied to the arbiter / GPU.
 *
 *   POST /api/admin/gpu/reset   → forwarded to pm-gpu-arbiter, which
 *                                 stops the TTS container and unloads
 *                                 Ollama models.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { effective } from "../services/llmConfig";
import {
  listLibraries as absListLibraries,
  testConnection as absTestConnection,
  uploadBook as absUploadBook,
} from "../services/audiobookshelf";
import { recent as recentLogs, subscribe as subscribeLogs } from "../services/logBus";

export const adminRoutes = new Hono();

function arbiterBaseUrl(): string {
  const u =
    effective("qwenTtsUrl", "PM_QWEN_TTS_URL") ||
    process.env.PM_GPU_ARBITER_URL ||
    "http://pm-gpu-arbiter:8790";
  return u.replace(/\/+$/, "");
}

function arbiterAuthHeaders(): Record<string, string> {
  const k = effective("qwenTtsApiKey", "PM_QWEN_TTS_API_KEY");
  return k ? { Authorization: `Bearer ${k}` } : {};
}

// =====================================================================
// Audiobookshelf integration
// =====================================================================

adminRoutes.get("/abs/test", async (c) => {
  const res = await absTestConnection();
  return c.json(res);
});

adminRoutes.get("/abs/libraries", async (c) => {
  try {
    const libraries = await absListLibraries();
    return c.json({ libraries });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

adminRoutes.post("/abs/upload/:docId", async (c) => {
  const docId = c.req.param("docId");
  try {
    const result = await absUploadBook(docId);
    return c.json({ ok: true, ...result });
  } catch (e) {
    console.error(`[abs] upload ${docId} failed:`, e);
    return c.json({ error: (e as Error).message }, 400);
  }
});

// =====================================================================
// GPU reset (existing)
// =====================================================================

adminRoutes.post("/gpu/reset", async (c) => {
  const url = `${arbiterBaseUrl()}/admin/gpu/reset`;
  try {
    // Ollama unload via keep_alive=0 can take 10-30 s depending on
    // model, container stop another ~10 s. 60 s buffer.
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...arbiterAuthHeaders(),
      },
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // arbiter can return plain text in edge cases
    }
    if (!res.ok) {
      return c.json(
        { error: `arbiter ${res.status}`, detail: parsed, url },
        502
      );
    }
    return c.json({ ok: true, result: parsed });
  } catch (err) {
    return c.json(
      {
        error: `arbiter unreachable`,
        detail: (err as Error).message,
        url,
      },
      502
    );
  }
});

// SSE: live merged log stream (backend console + sidecar diagnostics).
//
// New connections receive the in-memory ring buffer as a replay,
// then live updates as `event: log` SSE messages. Heartbeat comments
// every 20 s keep the connection alive past idle-aware proxies and
// browsers (same pattern as the audiobook progress stream).
adminRoutes.get("/logs/stream", (c) => {
  return streamSSE(c, async (stream) => {
    // Replay so a freshly opened LogsPage isn't blank.
    for (const line of recentLogs()) {
      await stream.writeSSE({
        event: "log",
        data: JSON.stringify(line),
      });
    }

    // Cap mirrors the logBus ring buffer: a stalled/slow client must
    // not grow the per-connection queue without bound during a log
    // burst (e.g. a docling run). Oldest lines drop first — the
    // client can always reload for the replay window.
    const MAX_QUEUE = 1000;
    const queue: string[] = [];
    let resolver: (() => void) | null = null;
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

    const unsubscribe = subscribeLogs((line) => {
      queue.push(JSON.stringify(line));
      if (queue.length > MAX_QUEUE) queue.shift();
      if (resolver) {
        const r = resolver;
        resolver = null;
        r();
      }
    });

    keepAliveTimer = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "" }).catch(() => {});
    }, 20_000);

    try {
      // Long-running async-pull loop: wait for the next event, ship it.
      // Closing the stream (client disconnect) throws and we land in finally.
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            resolver = resolve;
          });
        }
        while (queue.length > 0) {
          await stream.writeSSE({
            event: "log",
            data: queue.shift()!,
          });
        }
      }
    } finally {
      unsubscribe();
      if (keepAliveTimer) clearInterval(keepAliveTimer);
    }
  });
});
