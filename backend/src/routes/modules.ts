import { Hono } from "hono";
import { randomUUID } from "crypto";
import { db } from "../db";
import { tt } from "../lib/i18n";

export const moduleRoutes = new Hono();

interface Module {
  id: string;
  name: string;
  semester: string | null;
  description: string | null;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

/** List all modules with per-module aggregates (doc/card/audio counts,
 *  last exam score, etc.) — used by the module grid. */
moduleRoutes.get("/", (c) => {
  const d = db();
  const rows = d
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM documents doc WHERE doc.module_id = m.id) as doc_count,
              (SELECT COUNT(*) FROM documents doc WHERE doc.module_id = m.id AND doc.type = 'script') as script_count,
              (SELECT COUNT(*) FROM documents doc WHERE doc.module_id = m.id AND doc.type = 'klausur') as exam_doc_count,
              (SELECT COUNT(*) FROM documents doc WHERE doc.module_id = m.id AND doc.type = 'uebung') as exercise_doc_count,
              (SELECT COUNT(*) FROM cards c JOIN documents doc ON doc.id = c.document_id
                 WHERE doc.module_id = m.id) as card_count,
              (SELECT COUNT(*) FROM cards c
                 JOIN documents doc ON doc.id = c.document_id
                 LEFT JOIN progress p ON p.card_id = c.id
                 WHERE doc.module_id = m.id
                   AND (p.next_review IS NULL OR p.next_review <= datetime('now'))) as card_due,
              (SELECT COUNT(*) FROM audio a JOIN chapters ch ON ch.id = a.chapter_id
                 JOIN documents doc ON doc.id = ch.document_id
                 WHERE doc.module_id = m.id AND a.status = 'done') as audio_done,
              (SELECT COUNT(*) FROM exam_sessions s
                 JOIN documents doc ON doc.id = s.document_id
                 WHERE doc.module_id = m.id AND s.status = 'closed') as exam_count,
              (SELECT AVG(s.score) FROM exam_sessions s
                 JOIN documents doc ON doc.id = s.document_id
                 WHERE doc.module_id = m.id AND s.status = 'closed') as exam_avg_score
       FROM modules m
       ORDER BY m.sort_order ASC, m.created_at ASC`
    )
    .all();
  return c.json(rows);
});

/** Single module with all dependent entities (documents grouped by type,
 *  card stats, exam history) — used by the module detail view. */
moduleRoutes.get("/:id", (c) => {
  const id = c.req.param("id");
  const d = db();
  const m = d.prepare("SELECT * FROM modules WHERE id = ?").get(id) as Module | undefined;
  if (!m) return c.json({ error: tt(c, "err.notFound") }, 404);

  const documents = d
    .prepare(
      `SELECT id, title, filename, type, language, page_count, ocr_status,
              created_at,
              (SELECT COUNT(*) FROM chapters ch WHERE ch.document_id = documents.id) as chapter_count,
              (SELECT COUNT(*) FROM audio a JOIN chapters ch ON ch.id = a.chapter_id
                 WHERE ch.document_id = documents.id AND a.status = 'done') as audio_done,
              (SELECT COUNT(*) FROM cards c WHERE c.document_id = documents.id) as card_count
       FROM documents WHERE module_id = ?
       ORDER BY
         -- Series-Sequenz ist primaerer Sortier-Schluessel: "1" vor
         -- "2" vor "10". Numerische Werte werden als Zahl sortiert
         -- (CAST), Strings ohne fuehrende Ziffer landen ans Ende
         -- (CASE NULL/leer → 9999). Fallback Type+CreatedAt fuer
         -- Dokumente ohne Sequenz.
         CASE
           WHEN series_sequence IS NULL OR TRIM(series_sequence) = '' THEN 9999
           ELSE CAST(series_sequence AS INTEGER)
         END ASC,
         type ASC,
         created_at ASC`
    )
    .all(id);

  const cardStats = d
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM cards c JOIN documents doc ON doc.id = c.document_id
            WHERE doc.module_id = ?) as total,
         (SELECT COUNT(*) FROM cards c JOIN documents doc ON doc.id = c.document_id
            LEFT JOIN progress p ON p.card_id = c.id
            WHERE doc.module_id = ? AND (p.next_review IS NULL OR p.next_review <= datetime('now'))) as due,
         (SELECT COUNT(*) FROM cards c JOIN documents doc ON doc.id = c.document_id
            JOIN progress p ON p.card_id = c.id
            WHERE doc.module_id = ? AND p.reps >= 2) as learned`
    )
    .get(id, id, id);

  const exams = d
    .prepare(
      `SELECT s.id, s.title, s.score, s.total, s.taken_ms, s.status, s.created_at,
              s.finished_at, doc.title as document_title
       FROM exam_sessions s
       JOIN documents doc ON doc.id = s.document_id
       WHERE doc.module_id = ?
       ORDER BY s.created_at DESC
       LIMIT 50`
    )
    .all(id);

  const audioChapters = d
    .prepare(
      `SELECT a.id, a.duration_ms, a.voice, a.status,
              ch.title as chapter_title, ch.number as chapter_number,
              ch.sort_order,
              doc.id as document_id, doc.title as document_title, doc.type as document_type
       FROM audio a
       JOIN chapters ch ON ch.id = a.chapter_id
       JOIN documents doc ON doc.id = ch.document_id
       WHERE doc.module_id = ? AND a.status = 'done'
       ORDER BY doc.created_at ASC, ch.sort_order ASC, ch.number ASC`
    )
    .all(id);

  const summaries = d
    .prepare(
      `SELECT s.id, s.chapter_id, s.level, s.content, s.model, s.generation_ms, s.created_at,
              ch.title as chapter_title, ch.number as chapter_number,
              doc.id as document_id, doc.title as document_title
       FROM summaries s
       JOIN chapters ch ON ch.id = s.chapter_id
       JOIN documents doc ON doc.id = ch.document_id
       WHERE doc.module_id = ?
       ORDER BY doc.created_at ASC, ch.number ASC, s.created_at DESC`
    )
    .all(id);

  return c.json({
    module: m,
    documents,
    cardStats,
    exams,
    audioChapters,
    summaries,
  });
});

moduleRoutes.post("/", async (c) => {
  const body = await c.req.json<Partial<Module>>();
  if (!body.name) return c.json({ error: tt(c, "err.missingFields") }, 400);
  const id = randomUUID();
  db()
    .prepare(
      "INSERT INTO modules (id, name, semester, description, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      id,
      body.name,
      body.semester ?? null,
      body.description ?? null,
      body.color ?? "#ef4444",
      body.icon ?? "📘",
      body.sort_order ?? 0
    );
  return c.json({ id }, 201);
});

moduleRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<Module>>();
  const existing = db().prepare("SELECT id FROM modules WHERE id = ?").get(id);
  if (!existing) return c.json({ error: tt(c, "err.notFound") }, 404);

  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (["name", "semester", "description", "color", "icon", "sort_order"].includes(k)) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return c.json({ status: "noop" });
  vals.push(id);
  db().prepare(`UPDATE modules SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return c.json({ status: "ok" });
});

moduleRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const existing = db().prepare("SELECT id FROM modules WHERE id = ?").get(id);
  if (!existing) return c.json({ error: tt(c, "err.notFound") }, 404);
  db().prepare("DELETE FROM modules WHERE id = ?").run(id);
  // Documents stay (module_id set to NULL by FK ON DELETE SET NULL).
  return c.json({ status: "ok" });
});
