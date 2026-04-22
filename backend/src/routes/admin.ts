/**
 * Admin-Routen — für UI-Aktionen die am Arbiter / an der GPU hängen.
 *
 *   POST /api/admin/gpu/reset   → reicht an pm-gpu-arbiter durch,
 *                                 der stoppt den TTS-Container und
 *                                 entlädt Ollama-Modelle.
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
// Audiobookshelf-Integration
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
// GPU-Reset (bestehend)
// =====================================================================

adminRoutes.post("/gpu/reset", async (c) => {
  const url = `${arbiterBaseUrl()}/admin/gpu/reset`;
  try {
    // Ollama-Unload über keep_alive=0 kann je nach Modell 10–30 s
    // brauchen, Container-Stop nochmal ~10 s. 60 s Puffer.
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
      // arbiter kann in Edge-Cases Plain-Text zurückgeben
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
