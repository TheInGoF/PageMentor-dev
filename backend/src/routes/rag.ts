/**
 * RAG admin endpoints. Per-document Q&A used to live here as
 * `/query` and `/answer/stream`, but those were folded into the
 * module-scoped tutor (see routes/tutor.ts, services/tutor.ts). What
 * remains:
 *
 *   - GET  /status   → embedding-index health for the Settings page
 *   - POST /reembed  → back-fill embeddings for rows where the
 *                      `embedding_model` tag doesn't match the active
 *                      embedder; called manually after switching the
 *                      embedding model or recovering from a TEI outage
 */

import { Hono } from "hono";
import { db } from "../db";
import { resolveEmbedder, embedText } from "../services/embeddings";
import { syncVectors, vecState } from "../services/rag/vec";

export const ragRoutes = new Hono();

// Per-document /query and /answer/stream removed in favor of the
// module-scoped tutor (routes/tutor.ts). What remains here is purely
// the embed-index status + the back-fill reembed trigger, consumed by
// the Settings page.

/** Re-embed-all: fetches all chunks without an embedding (or with the
 *  wrong dimension) and embeds them. Useful when Ollama was offline
 *  during the initial extraction run. */
ragRoutes.post("/reembed", async (c) => {
  const embedder = await resolveEmbedder();
  if (!embedder) {
    return c.json({ error: "TEI embedding server unreachable." }, 503);
  }

  const rows = db()
    .prepare(
      "SELECT id, text FROM chunks WHERE embedding IS NULL OR embedding_model IS NULL OR embedding_model != ?"
    )
    .all(embedder.model) as Array<{ id: string; text: string }>;

  if (rows.length === 0) {
    return c.json({ status: "ok", embedded: 0, total: 0 });
  }

  const update = db().prepare(
    "UPDATE chunks SET embedding = ?, embedding_model = ? WHERE id = ?"
  );

  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    try {
      const emb = await embedText(row.text, embedder, "passage");
      update.run(Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength), embedder.model, row.id);
      ok++;
    } catch {
      fail++;
    }
  }

  const index = syncVectors(db());
  return c.json({ status: "ok", embedded: ok, failed: fail, total: rows.length, index });
});

/** Info endpoint: how many chunks + how many have embeddings? */
ragRoutes.get("/status", (c) => {
  const totals = db()
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as embedded,
         COUNT(DISTINCT document_id) as documents
       FROM chunks`
    )
    .get() as { total: number; embedded: number; documents: number };
  return c.json({ ...totals, vector: { available: vecState.available, error: vecState.error } });
});
