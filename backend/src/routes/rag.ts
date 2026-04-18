/**
 * RAG-Query-Endpoint. User schickt eine Frage, wir embedden die per
 * Ollama, vergleichen mit den gespeicherten Chunk-Vektoren via
 * Cosine-Similarity und liefern die Top-N relevantesten Schnipsel.
 *
 * Keine Vector-DB, keine Approximate-Search — bei < 10 k Chunks
 * macht Brute-Force in Node-/Bun-Prozess in < 100 ms keinen Unterschied.
 * Kann später ersetzt werden durch sqlite-vec wenn's eng wird.
 */

import { Hono } from "hono";
import { db } from "../db";
import {
  resolveEmbedder,
  embedText,
  embeddingFromBuffer,
  cosineSim,
} from "../services/embeddings";
import { tt } from "../lib/i18n";

export const ragRoutes = new Hono();

interface QueryBody {
  query: string;
  docId?: string;
  topK?: number;
}

interface RagHitRow {
  id: string;
  document_id: string;
  chapter_id: string;
  chunk_index: number;
  text: string;
  start_page: number;
  end_page: number;
  embedding: Buffer | null;
  chapter_number: number;
  chapter_title: string;
  chapter_kind: string;
  document_title: string;
}

ragRoutes.post("/query", async (c) => {
  let body: QueryBody;
  try {
    body = await c.req.json<QueryBody>();
  } catch {
    return c.json({ error: tt(c, "err.missingFields") }, 400);
  }
  const query = (body.query ?? "").trim();
  if (!query) return c.json({ error: tt(c, "err.missingFields") }, 400);
  const topK = Math.max(1, Math.min(20, body.topK ?? 5));

  const embedder = await resolveEmbedder();
  if (!embedder) {
    return c.json(
      { error: "No Ollama reachable for embedding the query. Configure it in Settings." },
      503
    );
  }

  const queryEmb = await embedText(query, embedder).catch((err) => {
    throw new Error(`embed query failed: ${(err as Error).message}`);
  });

  // Candidate rows + chapter + doc metadata.
  const sql = `
    SELECT ch.id, ch.document_id, ch.chapter_id, ch.chunk_index, ch.text,
           ch.start_page, ch.end_page, ch.embedding,
           c.number as chapter_number, c.title as chapter_title, c.kind as chapter_kind,
           d.title as document_title
    FROM chunks ch
    JOIN chapters c ON c.id = ch.chapter_id
    JOIN documents d ON d.id = ch.document_id
    WHERE ch.embedding IS NOT NULL
    ${body.docId ? "AND ch.document_id = ?" : ""}
  `;
  const rows = (body.docId
    ? db().prepare(sql).all(body.docId)
    : db().prepare(sql).all()) as RagHitRow[];

  if (rows.length === 0) {
    return c.json({
      hits: [],
      message:
        "No embedded chunks available. Re-run Docling extraction after Ollama + nomic-embed-text is online.",
    });
  }

  type Scored = RagHitRow & { score: number };
  const scored: Scored[] = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    const emb = embeddingFromBuffer(r.embedding);
    if (emb.length !== queryEmb.length) continue;
    const score = cosineSim(queryEmb, emb);
    scored.push({ ...r, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.slice(0, topK).map((h) => ({
    id: h.id,
    score: h.score,
    document_id: h.document_id,
    document_title: h.document_title,
    chapter_id: h.chapter_id,
    chapter_number: h.chapter_number,
    chapter_title: h.chapter_title,
    chapter_kind: h.chapter_kind,
    start_page: h.start_page,
    end_page: h.end_page,
    text: h.text,
  }));

  return c.json({ hits, query, topK, embedder: embedder.model });
});

/** Re-embed-all: holt alle Chunks ohne Embedding (oder mit falscher
 *  Dimension) und embedded sie. Hilfreich wenn Ollama beim initialen
 *  Extraction-Lauf offline war. */
ragRoutes.post("/reembed", async (c) => {
  const embedder = await resolveEmbedder();
  if (!embedder) {
    return c.json({ error: "No Ollama reachable." }, 503);
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
      const emb = await embedText(row.text, embedder);
      update.run(Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength), embedder.model, row.id);
      ok++;
    } catch {
      fail++;
    }
  }

  return c.json({ status: "ok", embedded: ok, failed: fail, total: rows.length });
});

/** Info-Endpoint: wie viele Chunks + wie viele haben Embeddings? */
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
  return c.json(totals);
});
