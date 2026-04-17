import { Hono } from "hono";
import { randomUUID } from "crypto";
import { db } from "../db";
import { tt } from "../lib/i18n";

export const examRoutes = new Hono();

interface StartBody {
  count?: number;
  durationMs?: number;
  chapterId?: string;
  title?: string;
}

// Start a new exam session: pick random cards from the pool.
examRoutes.post("/start/:docId", async (c) => {
  const docId = c.req.param("docId");
  const body = await c.req.json<StartBody>().catch(() => ({} as StartBody));

  const d = db();
  const doc = d.prepare("SELECT id, title FROM documents WHERE id = ?").get(docId) as
    | { id: string; title: string }
    | undefined;
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  const count = Math.max(1, Math.min(200, body.count ?? 20));
  const params: any[] = [docId];
  let sql = "SELECT id FROM cards WHERE document_id = ?";
  if (body.chapterId) {
    sql += " AND chapter_id = ?";
    params.push(body.chapterId);
  }
  sql += " ORDER BY RANDOM() LIMIT ?";
  params.push(count);

  const rows = d.prepare(sql).all(...params) as Array<{ id: string }>;
  if (rows.length === 0) {
    return c.json({ error: tt(c, "err.noCards") }, 400);
  }

  const sessionId = randomUUID();
  const cardIds = rows.map((r) => r.id);
  d.prepare(
    `INSERT INTO exam_sessions (id, document_id, title, card_ids_json, total, planned_duration_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, 'open')`
  ).run(
    sessionId,
    docId,
    body.title ?? `Klausur · ${new Date().toLocaleDateString("de-DE")}`,
    JSON.stringify(cardIds),
    cardIds.length,
    body.durationMs ?? null
  );

  return c.json({ id: sessionId, cardIds, total: cardIds.length });
});

// Get session + populated cards (without answers revealed yet for open sessions).
examRoutes.get("/:sessionId", (c) => {
  const row = db().prepare("SELECT * FROM exam_sessions WHERE id = ?").get(c.req.param("sessionId")) as
    | {
        id: string;
        document_id: string;
        title: string;
        card_ids_json: string;
        answers_json: string;
        score: number | null;
        total: number;
        planned_duration_ms: number | null;
        taken_ms: number | null;
        status: string;
        created_at: string;
        finished_at: string | null;
      }
    | undefined;
  if (!row) return c.json({ error: "Not found" }, 404);

  const cardIds = safeParse<string[]>(row.card_ids_json, []);
  const placeholders = cardIds.map(() => "?").join(",") || "''";
  const cards = cardIds.length
    ? db()
        .prepare(
          `SELECT c.id, c.question, c.answer, c.chapter_id, ch.title as chapter_title, ch.number as chapter_number
           FROM cards c LEFT JOIN chapters ch ON ch.id = c.chapter_id
           WHERE c.id IN (${placeholders})`
        )
        .all(...cardIds)
    : [];

  const order = new Map(cardIds.map((id, i) => [id, i]));
  (cards as any[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return c.json({
    ...row,
    card_ids: cardIds,
    answers: safeParse<Record<string, { text?: string; quality?: 1 | 3 | 5 }>>(row.answers_json, {}),
    cards,
  });
});

interface SubmitBody {
  answers: Record<string, { text?: string; quality: 1 | 3 | 5 }>;
  takenMs?: number;
}

examRoutes.post("/:sessionId/submit", async (c) => {
  const id = c.req.param("sessionId");
  const body = await c.req.json<SubmitBody>();
  if (!body.answers) return c.json({ error: tt(c, "err.missingAnswers") }, 400);

  const row = db().prepare("SELECT total, status FROM exam_sessions WHERE id = ?").get(id) as
    | { total: number; status: string }
    | undefined;
  if (!row) return c.json({ error: tt(c, "err.notFound") }, 404);
  if (row.status === "closed") return c.json({ error: tt(c, "err.alreadySubmitted") }, 409);

  const qualities = Object.values(body.answers);
  const correct = qualities.filter((a) => a.quality === 5).length;
  const partial = qualities.filter((a) => a.quality === 3).length;
  const score = Math.round(((correct + partial * 0.5) / row.total) * 100);

  db()
    .prepare(
      `UPDATE exam_sessions
       SET answers_json = ?, score = ?, taken_ms = ?, status = 'closed', finished_at = datetime('now')
       WHERE id = ?`
    )
    .run(JSON.stringify(body.answers), score, body.takenMs ?? null, id);

  return c.json({ status: "ok", score, correct, partial, total: row.total });
});

// List past sessions for a document.
examRoutes.get("/history/:docId", (c) => {
  const rows = db()
    .prepare(
      `SELECT id, title, score, total, planned_duration_ms, taken_ms, status, created_at, finished_at
       FROM exam_sessions WHERE document_id = ?
       ORDER BY created_at DESC LIMIT 50`
    )
    .all(c.req.param("docId"));
  return c.json(rows);
});

examRoutes.delete("/:sessionId", (c) => {
  db().prepare("DELETE FROM exam_sessions WHERE id = ?").run(c.req.param("sessionId"));
  return c.json({ status: "ok" });
});

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
