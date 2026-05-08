/**
 * RAG query endpoint. The user sends a question, we embed it via
 * Ollama, compare against stored chunk vectors via cosine similarity,
 * and return the top-N most relevant snippets.
 *
 * No vector DB, no approximate search — under 10 k chunks brute force
 * in the Node/Bun process makes no difference at < 100 ms. Can be
 * swapped for sqlite-vec later if it gets tight.
 */

import { Hono } from "hono";
import { db } from "../db";
import {
  resolveEmbedder,
  embedText,
  embeddingFromBuffer,
  cosineSim,
} from "../services/embeddings";
import { generateStream } from "../services/llm";
import { tt } from "../lib/i18n";

export const ragRoutes = new Hono();

interface RetrievalHit {
  id: string;
  score: number;
  document_id: string;
  document_title: string;
  chapter_id: string;
  chapter_number: number;
  chapter_title: string;
  chapter_kind: string;
  start_page: number;
  end_page: number;
  text: string;
}

/** Embeds the query, fetches top-K chunks via cosine over all chunks
 *  of the document. Throws if no embedder is reachable or the doc
 *  has no embedded chunks. */
async function retrieveTopK(params: {
  docId?: string;
  query: string;
  topK: number;
}): Promise<{ hits: RetrievalHit[]; embedderModel: string }> {
  const embedder = await resolveEmbedder();
  if (!embedder) {
    throw new Error("embedder_unreachable");
  }
  const queryEmb = await embedText(params.query, embedder, "query");

  const sql = `
    SELECT ch.id, ch.document_id, ch.chapter_id, ch.chunk_index, ch.text,
           ch.start_page, ch.end_page, ch.embedding,
           c.number as chapter_number, c.title as chapter_title, c.kind as chapter_kind,
           d.title as document_title
    FROM chunks ch
    JOIN chapters c ON c.id = ch.chapter_id
    JOIN documents d ON d.id = ch.document_id
    WHERE ch.embedding IS NOT NULL
    ${params.docId ? "AND ch.document_id = ?" : ""}
  `;
  const rows = (params.docId
    ? db().prepare(sql).all(params.docId)
    : db().prepare(sql).all()) as Array<RagHitRow>;

  const scored: Array<RetrievalHit & { score: number }> = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    const emb = embeddingFromBuffer(r.embedding);
    if (emb.length !== queryEmb.length) continue;
    const score = cosineSim(queryEmb, emb);
    scored.push({
      id: r.id,
      score,
      document_id: r.document_id,
      document_title: r.document_title,
      chapter_id: r.chapter_id,
      chapter_number: r.chapter_number,
      chapter_title: r.chapter_title,
      chapter_kind: r.chapter_kind,
      start_page: r.start_page,
      end_page: r.end_page,
      text: r.text,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return { hits: scored.slice(0, params.topK), embedderModel: embedder.model };
}

const ANSWER_SYSTEM_DE = `Du bist ein Lerncoach, der Fragen ausschließlich anhand der vorgelegten Quellen-Snippets aus einem Studienmaterial beantwortet.

Regeln:
- Stütze JEDE inhaltliche Aussage auf die Snippets. Erfinde nichts dazu.
- Belege jede Aussage mit der Snippet-Nummer in eckigen Klammern direkt nach dem Satz: "Die Definition lautet … [1]." Mehrere Belege als "[1][3]".
- Wenn die Snippets die Frage NICHT beantworten oder zu schwach belegen, sag das offen ("Die vorliegenden Quellen reichen für eine vollständige Antwort nicht aus, ich kann aber Folgendes sagen: …" oder "Dazu finde ich in den Quellen nichts.").
- Schreibe in klarem Deutsch, in einem strukturierten Antworttext (kurze Absätze, ggf. Bulletpoints für Aufzählungen).
- Keine Einleitung wie "Gerne erkläre ich dir …", direkt zur Sache.
- Keine Wiederholung der Frage.

Antwortformat: reines Markdown. Verwende ## für Zwischenüberschriften wenn sinnvoll, sonst Fließtext mit kurzen Absätzen. Zitiere am Satzende mit [n].`;

const ANSWER_SYSTEM_EN = `You are a study coach who answers questions strictly from the provided source snippets of study material.

Rules:
- Ground EVERY substantive statement in the snippets. Do not invent.
- Cite every statement with the snippet number in square brackets at the end of the sentence: "The definition is … [1]." Multiple sources as "[1][3]".
- If the snippets do NOT answer the question or are too weak, say so openly ("The provided sources don't fully answer this, but here is what I can say: …" or "I don't find this in the sources.").
- Write in clear English, structured (short paragraphs, bullets for enumerations).
- No preface like "I'd be happy to explain …", get straight to it.
- Don't repeat the question.

Response format: plain Markdown. Use ## for sub-headings if useful, otherwise short paragraphs. Cite at sentence end with [n].`;

function buildAnswerPrompt(
  query: string,
  hits: RetrievalHit[],
  language: string
): { system: string; prompt: string } {
  const isDe = language === "de";
  const system = isDe ? ANSWER_SYSTEM_DE : ANSWER_SYSTEM_EN;
  const sourceBlocks = hits
    .map((h, i) => {
      const pageRange =
        h.start_page === h.end_page
          ? `${isDe ? "S." : "p."} ${h.start_page}`
          : `${isDe ? "S." : "pp."} ${h.start_page}–${h.end_page}`;
      const header = isDe
        ? `[${i + 1}] Kapitel ${h.chapter_number} — ${h.chapter_title} (${pageRange})`
        : `[${i + 1}] Chapter ${h.chapter_number} — ${h.chapter_title} (${pageRange})`;
      return `${header}\n${h.text.trim()}`;
    })
    .join("\n\n---\n\n");
  const prompt = isDe
    ? `Frage des Studenten:\n${query}\n\n=== Quellen-Snippets ===\n${sourceBlocks}\n=== Ende der Quellen ===\n\nBeantworte die Frage anhand der Snippets, mit [n]-Zitaten am Satzende.`
    : `Student's question:\n${query}\n\n=== Source snippets ===\n${sourceBlocks}\n=== End of sources ===\n\nAnswer the question based on the snippets, with [n] citations at sentence end.`;
  return { system, prompt };
}

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

  let result: Awaited<ReturnType<typeof retrieveTopK>>;
  try {
    result = await retrieveTopK({ docId: body.docId, query, topK });
  } catch (err) {
    if ((err as Error).message === "embedder_unreachable") {
      return c.json(
        { error: "Embedding server (TEI) unreachable. Configure DS_TEI_URL in Settings or check the TEI container." },
        503
      );
    }
    return c.json({ error: (err as Error).message }, 500);
  }

  if (result.hits.length === 0) {
    return c.json({
      hits: [],
      message:
        "No embedded chunks available. Re-run Docling extraction after Ollama + nomic-embed-text is online.",
    });
  }

  return c.json({ hits: result.hits, query, topK, embedder: result.embedderModel });
});

interface AnswerBody {
  docId?: string;
  query: string;
  topK?: number;
  model?: string;
}

/** Streaming RAG answer. NDJSON events:
 *    { "type": "sources", "sources": [...] }
 *    { "type": "token",   "data": "..." }
 *    { "type": "done",    "model": "...", "content": "..." }
 *    { "type": "error",   "message": "..." }
 *  Sources are streamed first, then the LLM begins tokenizing. */
ragRoutes.post("/answer/stream", async (c) => {
  let body: AnswerBody;
  try {
    body = await c.req.json<AnswerBody>();
  } catch {
    return c.json({ error: tt(c, "err.missingFields") }, 400);
  }
  const query = (body.query ?? "").trim();
  if (!query) return c.json({ error: tt(c, "err.missingFields") }, 400);
  const topK = Math.max(1, Math.min(10, body.topK ?? 6));

  // Anchor language to the document — if docId is missing, default
  // to DE (sidekick is asked per-document most of the time anyway).
  let language = "de";
  if (body.docId) {
    const doc = db()
      .prepare("SELECT language FROM documents WHERE id = ?")
      .get(body.docId) as { language: string } | undefined;
    if (doc) language = doc.language;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const retrieved = await retrieveTopK({
          docId: body.docId,
          query,
          topK,
        });

        if (retrieved.hits.length === 0) {
          write({
            type: "error",
            message:
              language === "de"
                ? "Für dieses Dokument sind noch keine Embeddings vorhanden. Lass die Extraktion erneut laufen, sobald Ollama mit nomic-embed-text online ist."
                : "No embedded chunks for this document yet. Re-run extraction once Ollama with nomic-embed-text is online.",
          });
          return;
        }

        write({ type: "sources", sources: retrieved.hits });

        const { system, prompt } = buildAnswerPrompt(
          query,
          retrieved.hits,
          language
        );

        const { full, model } = await generateStream({
          prompt,
          system,
          model: body.model,
          options: { temperature: 0.2, top_p: 0.9 },
          onToken: (chunk) => write({ type: "token", data: chunk }),
        });

        write({ type: "done", model, content: full });
      } catch (err) {
        const msg =
          (err as Error).message === "embedder_unreachable"
            ? language === "de"
              ? "Ollama ist nicht erreichbar — keine RAG-Antwort möglich. Konfiguriere die LLM-Kette in den Einstellungen."
              : "Ollama is unreachable — no RAG answer possible. Configure the LLM chain in Settings."
            : err instanceof Error
              ? err.message
              : "RAG stream failed";
        write({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
});

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

  return c.json({ status: "ok", embedded: ok, failed: fail, total: rows.length });
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
  return c.json(totals);
});
