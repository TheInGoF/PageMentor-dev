import { Hono } from "hono";
import { randomUUID } from "crypto";
import { db } from "../db";
import {
  generate,
  generateStream,
  isAvailable,
  listModels,
  llmStatus,
} from "../services/llm";
import { tt } from "../lib/i18n";

export const summaryRoutes = new Hono();

type Level = "bullets" | "paragraph" | "detailed";
type PromptLang = "en" | "de";

interface PromptPair {
  system: string;
  prompt: (text: string) => string;
}

/**
 * Prompts are mirrored per (language, level). The LLM is instructed in the
 * same language as the source material so it does not switch mid-answer.
 */
const PROMPTS: Record<PromptLang, Record<Level, PromptPair>> = {
  en: {
    bullets: {
      system:
        "You summarise study material concisely and precisely. Respond ONLY with a Markdown bullet list. No introduction, no closing sentence.",
      prompt: (text) =>
        `Summarise the following chapter text in 6–9 clear bullet points. Keep technical terms. Language: English.\n\n---\n${text}`,
    },
    paragraph: {
      system:
        "You summarise study material precisely. Respond with one dense, flowing paragraph. No bullet lists, no filler like 'The text describes…'.",
      prompt: (text) =>
        `Summarise the following chapter text in a single dense paragraph (max 120 words). Language: English.\n\n---\n${text}`,
    },
    detailed: {
      system:
        "You write a structured, exam-ready summary. Use Markdown headings (##) for sections with short paragraphs underneath, and finish with a list of key terms.",
      prompt: (text) =>
        `Write a detailed exam-ready summary (3–5 sections with headings, each 2–3 short sentences, ending with a 'Key terms' list). Language: English.\n\n---\n${text}`,
    },
  },
  de: {
    bullets: {
      system:
        "Du fasst Studienmaterial kurz und exakt zusammen. Antworte NUR mit einer Markdown-Bulletpoint-Liste. Keine Einleitung, keine Schlusssätze.",
      prompt: (text) =>
        `Fasse den folgenden Kapiteltext in 6–9 klaren Bulletpoints zusammen. Bewahre Fachbegriffe. Sprache: Deutsch.\n\n---\n${text}`,
    },
    paragraph: {
      system:
        "Du fasst Studienmaterial präzise zusammen. Antworte in einem dichten, fließenden Absatz. Keine Bulletpoints, keine Einleitung wie 'Der Text beschreibt…'.",
      prompt: (text) =>
        `Fasse den folgenden Kapiteltext in einem dichten Absatz (maximal 120 Wörter) zusammen. Sprache: Deutsch.\n\n---\n${text}`,
    },
    detailed: {
      system:
        "Du erstellst eine strukturierte, prüfungstaugliche Zusammenfassung. Benutze Markdown-Headings (##) für Abschnitte, prägnante Absätze darunter, und eine abschließende Liste der wichtigsten Begriffe.",
      prompt: (text) =>
        `Erstelle eine ausführliche Prüfungs-Zusammenfassung (3–5 Abschnitte mit Überschriften, pro Abschnitt 2–3 kurze Sätze, am Ende eine Liste 'Kernbegriffe'). Sprache: Deutsch.\n\n---\n${text}`,
    },
  },
};

function pickPrompt(level: Level, lang: string): PromptPair {
  const l: PromptLang = lang === "de" ? "de" : "en";
  return PROMPTS[l][level];
}

// Status endpoint — exposes the active LLM provider, model list and
// the full candidate chain so the UI can show which box answered.
summaryRoutes.get("/status", async (c) => {
  void isAvailable; // retained for back-compat imports
  void listModels;
  return c.json(await llmStatus());
});

// List existing summaries for a chapter.
summaryRoutes.get("/chapter/:chapterId", (c) => {
  const rows = db()
    .prepare(
      "SELECT id, chapter_id, level, content, model, generation_ms, created_at FROM summaries WHERE chapter_id = ? ORDER BY created_at DESC"
    )
    .all(c.req.param("chapterId"));
  return c.json(rows);
});

// List summaries (latest per level) for a document.
summaryRoutes.get("/document/:docId", (c) => {
  const rows = db()
    .prepare(
      `SELECT s.id, s.chapter_id, s.level, s.content, s.model, s.generation_ms, s.created_at,
              c.number as chapter_number, c.title as chapter_title
       FROM summaries s
       JOIN chapters c ON c.id = s.chapter_id
       WHERE c.document_id = ?
       ORDER BY c.number ASC, s.created_at DESC`
    )
    .all(c.req.param("docId"));
  return c.json(rows);
});

// Generate summary for a single chapter.
summaryRoutes.post("/chapter/:chapterId", async (c) => {
  const chapterId = c.req.param("chapterId");
  const body = await c.req.json<{ level: Level; model?: string }>();
  const level = body.level;
  if (!(level in PROMPTS.en)) return c.json({ error: tt(c, "err.invalidLevel") }, 400);

  const row = db()
    .prepare(
      "SELECT c.id, c.text, c.number, c.title, d.language FROM chapters c JOIN documents d ON d.id = c.document_id WHERE c.id = ?"
    )
    .get(chapterId) as { id: string; text: string; number: number; title: string; language: string } | undefined;
  if (!row) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);
  if (!row.text || row.text.trim().length < 50) {
    return c.json({ error: tt(c, "err.chapterTooShortSummary") }, 400);
  }

  const snippet = row.text.slice(0, 24_000); // Keep within typical 8k-context * buffer
  const tpl = pickPrompt(level, row.language);

  try {
    const result = await generate({
      prompt: tpl.prompt(snippet),
      system: tpl.system,
      model: body.model,
    });
    const id = randomUUID();
    db()
      .prepare(
        "INSERT INTO summaries (id, chapter_id, level, content, model, generation_ms) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, chapterId, level, result.response, result.model, result.totalMs);
    return c.json({
      id,
      level,
      content: result.response,
      model: result.model,
      generation_ms: result.totalMs,
      totalMs: result.totalMs,
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : tt(c, "err.ollamaFailed") },
      503
    );
  }
});

// Streaming variant — emits tokens live as NDJSON stream
// (Content-Type application/x-ndjson). Events:
//   {"type":"token","data":"..."}
//   {"type":"done","id":"...","model":"...","content":"..."}
//   {"type":"error","message":"..."}
summaryRoutes.post("/chapter/:chapterId/stream", async (c) => {
  const chapterId = c.req.param("chapterId");
  const body = await c.req.json<{ level: Level; model?: string }>();
  const level = body.level;
  if (!(level in PROMPTS.en)) return c.json({ error: tt(c, "err.invalidLevel") }, 400);

  const row = db()
    .prepare(
      "SELECT c.id, c.text, c.number, c.title, d.language FROM chapters c JOIN documents d ON d.id = c.document_id WHERE c.id = ?"
    )
    .get(chapterId) as { id: string; text: string; number: number; title: string; language: string } | undefined;
  if (!row) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);
  if (!row.text || row.text.trim().length < 50) {
    return c.json({ error: tt(c, "err.chapterTooShort") }, 400);
  }

  const snippet = row.text.slice(0, 24_000);
  const tpl = pickPrompt(level, row.language);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const startedAt = Date.now();
        const { full, model } = await generateStream({
          prompt: tpl.prompt(snippet),
          system: tpl.system,
          model: body.model,
          onToken: (chunk) => write({ type: "token", data: chunk }),
        });
        const generationMs = Date.now() - startedAt;
        const id = randomUUID();
        db()
          .prepare(
            "INSERT INTO summaries (id, chapter_id, level, content, model, generation_ms) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run(id, chapterId, level, full, model, generationMs);
        write({ type: "done", id, model, content: full, generation_ms: generationMs });
      } catch (err) {
        write({
          type: "error",
          message: err instanceof Error ? err.message : "Ollama stream failed",
        });
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

summaryRoutes.delete("/:id", (c) => {
  db().prepare("DELETE FROM summaries WHERE id = ?").run(c.req.param("id"));
  return c.json({ status: "ok" });
});
