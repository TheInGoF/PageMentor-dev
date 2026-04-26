/**
 * Admin routes — for UI actions tied to the arbiter / GPU.
 *
 *   POST /api/admin/gpu/reset   → forwarded to pm-gpu-arbiter, which
 *                                 stops the TTS container and unloads
 *                                 Ollama models.
 */

import { Hono } from "hono";
import { effective } from "../services/llmConfig";
import {
  listLibraries as absListLibraries,
  testConnection as absTestConnection,
  uploadBook as absUploadBook,
} from "../services/audiobookshelf";

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
