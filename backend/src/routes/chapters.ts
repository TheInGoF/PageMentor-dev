import { Hono } from "hono";
import { db } from "../db";
import { processDocument } from "../services/pipeline";
import { tt } from "../lib/i18n";

export const chapterRoutes = new Hono();

// Re-run extraction + chapter detection
chapterRoutes.post("/detect/:docId", async (c) => {
  const docId = c.req.param("docId");
  const doc = db().prepare("SELECT id FROM documents WHERE id = ?").get(docId);
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  await processDocument(docId);
  const count = (db().prepare("SELECT COUNT(*) as n FROM chapters WHERE document_id = ?").get(docId) as { n: number }).n;
  return c.json({ status: "ok", chapters: count });
});

// List chapters for a document
chapterRoutes.get("/:docId", (c) => {
  const rows = db()
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM audio a WHERE a.chapter_id = c.id AND a.status = 'done') as has_audio
       FROM chapters c
       WHERE c.document_id = ?
       ORDER BY c.sort_order ASC, c.number ASC`
    )
    .all(c.req.param("docId"));
  return c.json(rows);
});

// Update chapter (title, text, boundaries)
chapterRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    title?: string;
    text?: string;
    start_page?: number;
    end_page?: number;
    sort_order?: number;
  }>();

  const chapter = db().prepare("SELECT id FROM chapters WHERE id = ?").get(id);
  if (!chapter) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);

  // Column whitelist — JSON keys must never reach the SET clause
  // verbatim, otherwise a crafted key injects SQL.
  const PATCHABLE = ["title", "text", "start_page", "end_page", "sort_order"] as const;
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  for (const k of PATCHABLE) {
    const v = body[k];
    if (v !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  // When the user edits the chapter text, the LLM-prepared audio
  // variant is stale — otherwise the audiobook would lag the read text.
  if (body.text !== undefined) {
    sets.push("audio_text = NULL", "audio_text_model = NULL");
  }
  if (sets.length > 0) {
    vals.push(id);
    db().prepare(`UPDATE chapters SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  const updated = db().prepare("SELECT * FROM chapters WHERE id = ?").get(id);
  return c.json(updated);
});

chapterRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const existing = db().prepare("SELECT id FROM chapters WHERE id = ?").get(id);
  if (!existing) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);
  db().prepare("DELETE FROM chapters WHERE id = ?").run(id);
  return c.json({ status: "ok" });
});

// Merge two chapters
chapterRoutes.post("/merge", async (c) => {
  const { chapter_ids } = await c.req.json<{ chapter_ids: string[] }>();
  if (!chapter_ids || chapter_ids.length < 2) {
    return c.json({ error: tt(c, "err.missingFields") }, 400);
  }

  const d = db();
  const chapters = chapter_ids
    .map((id) => d.prepare("SELECT * FROM chapters WHERE id = ?").get(id))
    .filter(Boolean) as any[];

  if (chapters.length < 2) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);

  chapters.sort((a, b) => a.sort_order - b.sort_order);
  const first = chapters[0];
  const last = chapters[chapters.length - 1];
  const mergedText = chapters.map((ch) => ch.text).join("\n\n");

  // Invalidate audio cache — the merged text must be re-preprocessed
  // (transitions between original chapters).
  d.prepare(
    "UPDATE chapters SET title = ?, text = ?, start_page = ?, end_page = ?, audio_text = NULL, audio_text_model = NULL WHERE id = ?"
  ).run(
    first.title,
    mergedText,
    first.start_page,
    last.end_page,
    first.id
  );

  for (const ch of chapters.slice(1)) {
    d.prepare("DELETE FROM chapters WHERE id = ?").run(ch.id);
  }

  return c.json({ status: "ok", kept: first.id });
});
