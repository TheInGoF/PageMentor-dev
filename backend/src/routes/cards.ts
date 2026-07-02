import { Hono } from "hono";
import { randomUUID } from "crypto";
import { db } from "../db";
import { initialState, updateProgress, type Quality } from "../services/sm2";
import {
  runCardBuild,
  cancelCardBuild,
  isCardBuildActive,
} from "../services/cardGenerate";
import { tt } from "../lib/i18n";

export const cardRoutes = new Hono();

// ---------------------------------------------------------------------
// Read / list / stats
// ---------------------------------------------------------------------

cardRoutes.get("/document/:docId", (c) => {
  const docId = c.req.param("docId");
  const chapterId = c.req.query("chapter");
  const params: string[] = [docId];
  let sql = `SELECT c.*, ch.title as chapter_title, ch.number as chapter_number,
                    p.ease, p.reps, p.streak, p.next_review, p.last_seen
             FROM cards c
             LEFT JOIN chapters ch ON ch.id = c.chapter_id
             LEFT JOIN progress p ON p.card_id = c.id
             WHERE c.document_id = ?`;
  if (chapterId) {
    sql += " AND c.chapter_id = ?";
    params.push(chapterId);
  }
  sql += " ORDER BY ch.sort_order ASC, ch.number ASC, c.created_at ASC";
  const rows = db().prepare(sql).all(...params);
  return c.json(rows);
});

cardRoutes.get("/stats/:docId", (c) => {
  const docId = c.req.param("docId");
  const d = db();
  const total = (d.prepare("SELECT COUNT(*) as n FROM cards WHERE document_id = ?").get(docId) as { n: number }).n;
  const due = (d
    .prepare(
      `SELECT COUNT(*) as n FROM cards c
       LEFT JOIN progress p ON p.card_id = c.id
       WHERE c.document_id = ? AND (p.next_review IS NULL OR p.next_review <= datetime('now'))`
    )
    .get(docId) as { n: number }).n;
  const learned = (d
    .prepare(
      `SELECT COUNT(*) as n FROM cards c JOIN progress p ON p.card_id = c.id
       WHERE c.document_id = ? AND p.reps >= 2`
    )
    .get(docId) as { n: number }).n;
  return c.json({ total, due, learned });
});

cardRoutes.get("/due/:docId", (c) => {
  const rows = db()
    .prepare(
      `SELECT c.*, p.ease, p.reps, p.streak, p.next_review, p.last_seen
       FROM cards c
       LEFT JOIN progress p ON p.card_id = c.id
       WHERE c.document_id = ?
         AND (p.next_review IS NULL OR p.next_review <= datetime('now'))
       ORDER BY RANDOM()
       LIMIT 100`
    )
    .all(c.req.param("docId"));
  return c.json(rows);
});

// ---------------------------------------------------------------------
// Write: manual create, edit, delete, bulk delete
// ---------------------------------------------------------------------

cardRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    document_id: string;
    chapter_id?: string | null;
    question: string;
    answer?: string;
    hint?: string;
    difficulty?: "easy" | "medium" | "hard";
    source_page?: number;
  }>();
  if (!body.document_id || !body.question)
    return c.json({ error: tt(c, "err.missingFields") }, 400);

  const id = randomUUID();
  db()
    .prepare(
      "INSERT INTO cards (id, document_id, chapter_id, question, answer, hint, difficulty, source_page, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')"
    )
    .run(
      id,
      body.document_id,
      body.chapter_id ?? null,
      body.question,
      body.answer ?? "",
      body.hint ?? null,
      body.difficulty ?? "medium",
      body.source_page ?? null
    );
  return c.json({ id }, 201);
});

cardRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    question?: string;
    answer?: string;
    hint?: string | null;
    difficulty?: "easy" | "medium" | "hard";
  }>();

  const card = db().prepare("SELECT id FROM cards WHERE id = ?").get(id);
  if (!card) return c.json({ error: tt(c, "err.notFound") }, 404);

  // Column whitelist — JSON keys must never reach the SET clause
  // verbatim, otherwise a crafted key injects SQL.
  const PATCHABLE = ["question", "answer", "hint", "difficulty"] as const;
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  for (const k of PATCHABLE) {
    const v = body[k];
    if (v !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return c.json({ status: "noop" });
  vals.push(id);
  db().prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return c.json({ status: "ok" });
});

cardRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  db().prepare("DELETE FROM cards WHERE id = ?").run(id);
  return c.json({ status: "ok" });
});

/** Hard reset: wipe every card (and progress, via FK cascade) for a
 *  document. Used by the "Alle löschen"-Button when the user wants to
 *  start fresh before a re-build. */
cardRoutes.delete("/all/:docId", (c) => {
  const docId = c.req.param("docId");
  const res = db()
    .prepare("DELETE FROM cards WHERE document_id = ?")
    .run(docId);
  return c.json({ deleted: res.changes ?? 0 });
});

// ---------------------------------------------------------------------
// SM-2 review
// ---------------------------------------------------------------------

cardRoutes.post("/:id/review", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ quality: Quality }>();
  const quality = body.quality;
  if (![1, 3, 5].includes(quality))
    return c.json({ error: tt(c, "err.invalidQuality") }, 400);

  const d = db();
  const card = d.prepare("SELECT id FROM cards WHERE id = ?").get(id);
  if (!card) return c.json({ error: tt(c, "err.notFound") }, 404);

  const existing = d
    .prepare("SELECT * FROM progress WHERE card_id = ?")
    .get(id) as
    | {
        id: string;
        ease: number;
        reps: number;
        streak: number;
        last_seen: string;
        next_review: string;
      }
    | undefined;

  const prevState = existing
    ? {
        ease: existing.ease,
        reps: existing.reps,
        streak: existing.streak,
        lastSeenAt: new Date(existing.last_seen),
        nextReviewAt: new Date(existing.next_review),
      }
    : initialState();

  const nextState = updateProgress(prevState, quality);

  if (existing) {
    d.prepare(
      "UPDATE progress SET ease = ?, reps = ?, streak = ?, last_seen = ?, next_review = ? WHERE card_id = ?"
    ).run(
      nextState.ease,
      nextState.reps,
      nextState.streak,
      isoNow(nextState.lastSeenAt),
      isoNow(nextState.nextReviewAt),
      id
    );
  } else {
    d.prepare(
      "INSERT INTO progress (id, card_id, ease, reps, streak, last_seen, next_review) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      randomUUID(),
      id,
      nextState.ease,
      nextState.reps,
      nextState.streak,
      isoNow(nextState.lastSeenAt),
      isoNow(nextState.nextReviewAt)
    );
  }

  return c.json({
    status: "ok",
    nextReview: nextState.nextReviewAt.toISOString(),
    ease: nextState.ease,
    reps: nextState.reps,
    streak: nextState.streak,
  });
});

// ---------------------------------------------------------------------
// Import / Export (Anki-compatible CSV)
// ---------------------------------------------------------------------

cardRoutes.get("/export/:docId", (c) => {
  const docId = c.req.param("docId");
  const format = (c.req.query("format") || "csv").toLowerCase();

  const rows = db()
    .prepare(
      `SELECT c.question, c.answer, c.difficulty, ch.title as chapter_title, ch.number as chapter_number
       FROM cards c
       LEFT JOIN chapters ch ON ch.id = c.chapter_id
       WHERE c.document_id = ?
       ORDER BY ch.number ASC, c.created_at ASC`
    )
    .all(docId) as Array<{
    question: string;
    answer: string;
    difficulty: string;
    chapter_title: string | null;
    chapter_number: number | null;
  }>;

  const doc = db().prepare("SELECT title FROM documents WHERE id = ?").get(docId) as
    | { title: string }
    | undefined;
  const baseName = (doc?.title || "cards").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);

  if (format === "json") {
    return new Response(JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${baseName}.json"`,
      },
    });
  }

  const lines: string[] = ["question;answer;tags;difficulty"];
  for (const r of rows) {
    const tag = r.chapter_number ? `kap${String(r.chapter_number).padStart(2, "0")}` : "manual";
    lines.push(
      [
        csvCell(r.question),
        csvCell(r.answer),
        csvCell(tag),
        csvCell(r.difficulty || "medium"),
      ].join(";")
    );
  }
  const csv = "﻿" + lines.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}.csv"`,
    },
  });
});

cardRoutes.post("/import/:docId", async (c) => {
  const docId = c.req.param("docId");
  const doc = db().prepare("SELECT id FROM documents WHERE id = ?").get(docId);
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  if (!file) return c.json({ error: tt(c, "err.missingFile") }, 400);

  const text = await file.text();
  const clean = text.replace(/^﻿/, "");
  const rows = parseCsv(clean);
  if (rows.length < 2) return c.json({ error: tt(c, "err.csvEmpty") }, 400);

  const header = rows[0].map((h) => h.toLowerCase().trim());
  const qIdx = header.indexOf("question");
  const aIdx = header.indexOf("answer");
  const dIdx = header.indexOf("difficulty");
  const hIdx = header.indexOf("hint");
  if (qIdx === -1 || aIdx === -1) {
    return c.json({ error: tt(c, "err.csvColumns") }, 400);
  }

  const insert = db().prepare(
    "INSERT INTO cards (id, document_id, chapter_id, question, answer, hint, difficulty, source) VALUES (?, ?, NULL, ?, ?, ?, ?, 'manual')"
  );
  const tx = db().transaction((records: string[][]) => {
    let n = 0;
    for (const row of records) {
      const q = (row[qIdx] || "").replace(/<br>/g, "\n").trim();
      const a = (row[aIdx] || "").replace(/<br>/g, "\n").trim();
      if (!q) continue;
      const diff = dIdx !== -1 ? (row[dIdx] || "medium").trim() : "medium";
      const hint = hIdx !== -1 ? (row[hIdx] || "").trim() || null : null;
      insert.run(randomUUID(), docId, q, a, hint, diff);
      n++;
    }
    return n;
  });
  const imported = tx(rows.slice(1));
  return c.json({ imported });
});

// ---------------------------------------------------------------------
// Build (the single generation entrypoint)
// ---------------------------------------------------------------------

/** Start the chunked, sequential chapter-by-chapter build. Fire-and-
 *  forget: returns immediately with status 202, progress streams over
 *  the existing per-doc SSE channel (cards.start / cards.chapter /
 *  cards.chunk / cards.progress / cards.done|failed|canceled). */
cardRoutes.post("/build/:docId", (c) => {
  const docId = c.req.param("docId");
  const doc = db().prepare("SELECT id FROM documents WHERE id = ?").get(docId);
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  if (isCardBuildActive(docId)) return c.json({ status: "busy" }, 409);

  // ?rebuild=true → wipe + start over. Default = resume.
  const rebuild = c.req.query("rebuild") === "true";
  // ?model=… → frontend per-user override (same pattern Audio uses).
  // Wins over server-side Settings → ollamaModel. Empty = use server.
  const model = c.req.query("model") || undefined;

  void runCardBuild(docId, { rebuild, model }).catch((err) =>
    console.error(
      `[cards.build] ${docId} crashed:`,
      err instanceof Error ? err.stack : err
    )
  );
  return c.json({ status: "started", rebuild, model: model || null }, 202);
});

cardRoutes.get("/build/:docId", (c) => {
  return c.json({ active: isCardBuildActive(c.req.param("docId")) });
});

/** Cancel after the currently-running Gemma call returns. We never
 *  interrupt an in-flight LLM call mid-token — Ollama doesn't react
 *  well — but we stop scheduling further chunks. */
cardRoutes.delete("/build/:docId", (c) => {
  const docId = c.req.param("docId");
  const canceled = cancelCardBuild(docId);
  return c.json({ canceled });
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === sep) {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        if (row.length > 1 || row[0].length > 0) rows.push(row);
        row = [];
        cell = "";
      } else cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csvCell(s: string | null | undefined): string {
  if (s == null) return '""';
  const esc = String(s).replace(/\r?\n/g, "<br>").replace(/"/g, '""');
  return `"${esc}"`;
}

function isoNow(d: Date): string {
  // SQLite stores datetime as "YYYY-MM-DD HH:MM:SS" (UTC).
  return d.toISOString().slice(0, 19).replace("T", " ");
}
