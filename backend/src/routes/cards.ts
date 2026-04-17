import { Hono } from "hono";
import { randomUUID } from "crypto";
import { db } from "../db";
import { extractCards } from "../services/cards";
import { initialState, updateProgress, type Quality } from "../services/sm2";
import { generate as ollamaGenerate, isAvailable as ollamaAvailable } from "../services/ollama";
import { tt } from "../lib/i18n";

export const cardRoutes = new Hono();

interface Chapter {
  id: string;
  document_id: string;
  number: number;
  title: string;
  text: string;
  start_page: number;
}

// List cards for a document (optionally filter by chapter).
cardRoutes.get("/document/:docId", (c) => {
  const docId = c.req.param("docId");
  const chapterId = c.req.query("chapter");
  const params: any[] = [docId];
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

// Extract cards from all chapters of a document.
cardRoutes.post("/extract/:docId", async (c) => {
  const docId = c.req.param("docId");
  const body = await c.req
    .json<{ replace?: boolean }>()
    .catch(() => ({ replace: false }));

  const d = db();
  const doc = d.prepare("SELECT id FROM documents WHERE id = ?").get(docId);
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  const chapters = d
    .prepare("SELECT id, document_id, number, title, text, start_page FROM chapters WHERE document_id = ? ORDER BY sort_order")
    .all(docId) as Chapter[];

  if (body.replace) {
    d.prepare("DELETE FROM cards WHERE document_id = ? AND source = 'extracted'").run(docId);
  }

  let total = 0;
  const insert = d.prepare(
    "INSERT INTO cards (id, document_id, chapter_id, question, answer, difficulty, source_page, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'extracted')"
  );

  const tx = d.transaction(() => {
    for (const ch of chapters) {
      const cards = extractCards(ch.text);
      for (const card of cards) {
        insert.run(
          randomUUID(),
          docId,
          ch.id,
          card.question,
          card.answer,
          card.difficulty ?? "medium",
          ch.start_page
        );
        total++;
      }
    }
  });
  tx();

  return c.json({ status: "ok", extracted: total, chapters: chapters.length });
});

// Create a manual card.
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
  if (!body.document_id || !body.question) return c.json({ error: tt(c, "err.missingFields") }, 400);

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

// Update a card (title/answer/hint/difficulty).
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

  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(body)) {
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

// Cards due for review (next_review <= now OR never reviewed).
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

// Review a card with quality (1/3/5) — updates SM-2 progress.
cardRoutes.post("/:id/review", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ quality: Quality }>();
  const quality = body.quality;
  if (![1, 3, 5].includes(quality)) return c.json({ error: tt(c, "err.invalidQuality") }, 400);

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

// CSV-Export (Anki-kompatibel: "question";"answer" semikolongetrennt mit Quotes).
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

  // Default CSV
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
  const csv = "\uFEFF" + lines.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}.csv"`,
    },
  });
});

// CSV-Import (komplementär zum Export). Akzeptiert UTF-8 CSV mit
// ";" oder "," als Trenner. Erste Zeile wird als Header interpretiert,
// erwartet werden die Spalten "question" und "answer" (Rest optional).
cardRoutes.post("/import/:docId", async (c) => {
  const docId = c.req.param("docId");
  const doc = db().prepare("SELECT id FROM documents WHERE id = ?").get(docId);
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  if (!file) return c.json({ error: tt(c, "err.missingFile") }, 400);

  const text = await file.text();
  // Strip UTF-8 BOM
  const clean = text.replace(/^\uFEFF/, "");
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

// Minimal RFC-4180-ish CSV parser with `;` and `,` autodetect.
function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

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

// Aggregate stats for a document (for the "Übungen"-Tab header).
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

// Generate new cards from a chapter using Ollama.
cardRoutes.post("/ai-generate/:chapterId", async (c) => {
  const chapterId = c.req.param("chapterId");
  const body = await c.req.json<{
    count?: number;
    difficulty?: "easy" | "medium" | "hard";
    style?: "basic" | "deep" | "exam";
  }>();
  const count = Math.max(1, Math.min(15, body.count ?? 5));
  const difficulty = body.difficulty ?? "medium";
  const style = body.style ?? "deep";

  const d = db();
  const ch = d
    .prepare(
      "SELECT c.id, c.document_id, c.text, c.number, c.title, c.start_page, doc.language FROM chapters c JOIN documents doc ON doc.id = c.document_id WHERE c.id = ?"
    )
    .get(chapterId) as
    | { id: string; document_id: string; text: string; number: number; title: string; start_page: number; language: string }
    | undefined;
  if (!ch) return c.json({ error: tt(c, "err.chapterNotFound") }, 404);
  if (!ch.text || ch.text.length < 100)
    return c.json({ error: tt(c, "err.chapterTooShort") }, 400);

  if (!(await ollamaAvailable())) {
    return c.json({ error: tt(c, "err.ollamaUnavailable") }, 503);
  }

  const lang = ch.language === "de" ? "de" : "en";
  const snippet = ch.text.slice(0, 20_000);

  const system =
    lang === "de"
      ? "Du erstellst Lernkarten aus einem Kapiteltext. Antworte AUSSCHLIESSLICH mit einem validen JSON-Array. Keine Einleitung, keine Codefences, keine Kommentare. Jede Karte hat question und answer (beide String)."
      : "You create flashcards from a chapter of study material. Respond ONLY with a valid JSON array. No introduction, no code fences, no comments. Each card has question and answer (both strings).";

  const styleLabel =
    lang === "de"
      ? style === "basic"
        ? "Grundlagen-Verständnis"
        : style === "exam"
        ? "Klausur-Niveau mit anspruchsvollen Transfer-Fragen"
        : "tiefe Auseinandersetzung mit Details"
      : style === "basic"
      ? "foundational understanding"
      : style === "exam"
      ? "exam level with challenging transfer questions"
      : "deep engagement with the material";

  const prompt =
    lang === "de"
      ? `Erstelle exakt ${count} Lernkarten (${styleLabel}, Schwierigkeit ${difficulty}). ` +
        `Format: [{"question": "…", "answer": "…"}, …]\n\nKapiteltext:\n${snippet}`
      : `Generate exactly ${count} flashcards (${styleLabel}, difficulty ${difficulty}). ` +
        `Format: [{"question": "…", "answer": "…"}, …]\n\nChapter text:\n${snippet}`;

  let result;
  try {
    result = await ollamaGenerate({ prompt, system });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : tt(c, "err.ollamaFailed") },
      503
    );
  }

  const parsed = parseCards(result.response);
  if (parsed.length === 0) {
    return c.json({ error: tt(c, "err.csvParseFailed") }, 502);
  }

  const insert = d.prepare(
    "INSERT INTO cards (id, document_id, chapter_id, question, answer, difficulty, source_page, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'ai_generated')"
  );
  const tx = d.transaction(() => {
    for (const card of parsed) {
      insert.run(
        randomUUID(),
        ch.document_id,
        chapterId,
        card.question,
        card.answer,
        difficulty,
        ch.start_page
      );
    }
  });
  tx();

  return c.json({ generated: parsed.length, model: result.model });
});

// Generate 3 new cards similar to an existing one using Ollama.
cardRoutes.post("/similar/:cardId", async (c) => {
  const cardId = c.req.param("cardId");
  const d = db();
  const card = d
    .prepare(
      `SELECT c.question, c.answer, c.document_id, c.chapter_id, c.difficulty, c.source_page,
              ch.text as chapter_text, doc.language
       FROM cards c
       LEFT JOIN chapters ch ON ch.id = c.chapter_id
       JOIN documents doc ON doc.id = c.document_id
       WHERE c.id = ?`
    )
    .get(cardId) as
    | {
        question: string;
        answer: string;
        document_id: string;
        chapter_id: string | null;
        difficulty: string;
        source_page: number | null;
        chapter_text: string | null;
        language: string;
      }
    | undefined;
  if (!card) return c.json({ error: tt(c, "err.notFound") }, 404);

  if (!(await ollamaAvailable())) {
    return c.json({ error: tt(c, "err.ollamaUnavailable") }, 503);
  }

  const lang = card.language === "de" ? "de" : "en";
  const system =
    lang === "de"
      ? "Du generierst Lernkarten im Stil einer Beispielkarte. Antworte NUR mit einem validen JSON-Array, keine Prose, keine Codefences."
      : "You generate flashcards in the style of an example card. Respond ONLY with a valid JSON array, no prose, no code fences.";

  const context = (card.chapter_text || "").slice(0, 8_000);
  const prompt =
    lang === "de"
      ? `Erstelle 3 neue Lernkarten zum gleichen Thema wie die Beispielkarte. Gleiche Schwierigkeit, ähnlicher Stil, aber unterschiedliche Fragen. Format: [{"question":"…","answer":"…"}, …]\n\nBeispielkarte:\nFrage: ${card.question}\nAntwort: ${card.answer}\n\nKapitelkontext:\n${context}`
      : `Create 3 new flashcards on the same topic as the example card. Same difficulty, similar style, but different questions. Format: [{"question":"…","answer":"…"}, …]\n\nExample card:\nQuestion: ${card.question}\nAnswer: ${card.answer}\n\nChapter context:\n${context}`;

  let result;
  try {
    result = await ollamaGenerate({ prompt, system });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Ollama failed" }, 503);
  }

  const parsed = parseCards(result.response);
  if (parsed.length === 0) {
    return c.json({ error: tt(c, "err.csvParseFailed") }, 502);
  }

  const insert = d.prepare(
    "INSERT INTO cards (id, document_id, chapter_id, question, answer, difficulty, source_page, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'ai_generated')"
  );
  const tx = d.transaction(() => {
    for (const n of parsed.slice(0, 5)) {
      insert.run(
        randomUUID(),
        card.document_id,
        card.chapter_id,
        n.question,
        n.answer,
        card.difficulty,
        card.source_page
      );
    }
  });
  tx();

  return c.json({ generated: Math.min(parsed.length, 5), model: result.model });
});

function parseCards(raw: string): Array<{ question: string; answer: string }> {
  // Strip markdown codefences if the model decided to add any.
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  // Find the outermost JSON array (first '[' to last ']').
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    const jsonSlice = text.slice(start, end + 1);
    try {
      const parsed = JSON.parse(jsonSlice);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((x) => x && typeof x.question === "string" && typeof x.answer === "string")
          .map((x) => ({
            question: String(x.question).trim(),
            answer: String(x.answer).trim(),
          }))
          .filter((c) => c.question.length > 4);
      }
    } catch {
      // fallthrough to regex
    }
  }

  // Fallback: extract "question":"…","answer":"…" pairs via regex
  const out: Array<{ question: string; answer: string }> = [];
  const re = /"question"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"answer"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({
      question: unescapeJson(m[1]).trim(),
      answer: unescapeJson(m[2]).trim(),
    });
  }
  return out;
}

function unescapeJson(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function isoNow(d: Date): string {
  // SQLite stores as "YYYY-MM-DD HH:MM:SS" (UTC). datetime('now') returns this format.
  const iso = d.toISOString();
  return iso.slice(0, 19).replace("T", " ");
}
