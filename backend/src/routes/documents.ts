import { Hono } from "hono";
import { db } from "../db";
import { randomUUID } from "crypto";
import { basename, join } from "path";
import { mkdirSync, writeFileSync, unlinkSync, existsSync, rmSync } from "fs";
import { processDocument, cancelProcessing } from "../services/pipeline";
import { doclingAlive } from "../services/docling";
import { removeDocument as removeFromIndex } from "../services/search";
import { tt } from "../lib/i18n";
import { DATA_DIR, fromDataPath } from "../paths";

const UPLOAD_DIR = join(DATA_DIR, "uploads");

export const documentRoutes = new Hono();

// List all documents with aggregate pipeline counts.
documentRoutes.get("/", (c) => {
  const moduleId = c.req.query("module");
  const unassigned = c.req.query("unassigned") === "1";

  const where: string[] = [];
  const params: any[] = [];
  if (moduleId) {
    where.push("d.module_id = ?");
    params.push(moduleId);
  } else if (unassigned) {
    where.push("d.module_id IS NULL");
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db()
    .prepare(
      `SELECT d.*,
              GROUP_CONCAT(DISTINCT t.label) as tag_labels,
              (SELECT code FROM modules m WHERE m.id = d.assign_module_id) as assign_code,
              (SELECT name FROM modules m WHERE m.id = d.assign_module_id) as assign_name,
              (SELECT COUNT(*) FROM chapters ch WHERE ch.document_id = d.id) as chapter_count,
              (SELECT COUNT(*) FROM cards c WHERE c.document_id = d.id) as card_count,
              (SELECT COUNT(*) FROM audio a JOIN chapters ch ON ch.id = a.chapter_id
                WHERE ch.document_id = d.id AND a.status = 'done') as audio_done,
              (SELECT COUNT(*) FROM audio a JOIN chapters ch ON ch.id = a.chapter_id
                WHERE ch.document_id = d.id) as audio_total,
              (SELECT COUNT(*) FROM summaries s JOIN chapters ch ON ch.id = s.chapter_id
                WHERE ch.document_id = d.id) as summary_count
       FROM documents d
       LEFT JOIN document_tags dt ON dt.document_id = d.id
       LEFT JOIN tags t ON t.id = dt.tag_id
       ${whereSql}
       GROUP BY d.id
       ORDER BY d.created_at DESC`
    )
    .all(...params);

  return c.json(
    rows.map((r: any) => ({
      ...r,
      tags: r.tag_labels ? r.tag_labels.split(",") : [],
      tag_labels: undefined,
      chapter_count: r.chapter_count ?? 0,
      card_count: r.card_count ?? 0,
      audio_done: r.audio_done ?? 0,
      audio_total: r.audio_total ?? 0,
      summary_count: r.summary_count ?? 0,
    }))
  );
});

// Docling-Serve health — for the status panel in Settings.
documentRoutes.get("/docling/status", async (c) => {
  const alive = await doclingAlive();
  return c.json({ alive });
});

// List all known tag labels with usage-count — used for autocomplete.
documentRoutes.get("/tags/all", (c) => {
  const rows = db()
    .prepare(
      `SELECT t.label, COUNT(dt.document_id) as usage
       FROM tags t
       LEFT JOIN document_tags dt ON dt.tag_id = t.id
       GROUP BY t.id
       ORDER BY usage DESC, t.label ASC`
    )
    .all();
  return c.json(rows);
});

// Get single document (with tags so the shape matches the list query).
documentRoutes.get("/:id", (c) => {
  const id = c.req.param("id");
  const row = db()
    .prepare(
      `SELECT d.*, GROUP_CONCAT(DISTINCT t.label) as tag_labels
       FROM documents d
       LEFT JOIN document_tags dt ON dt.document_id = d.id
       LEFT JOIN tags t ON t.id = dt.tag_id
       WHERE d.id = ?
       GROUP BY d.id`
    )
    .get(id) as any;
  if (!row) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  return c.json({
    ...row,
    tags: row.tag_labels ? String(row.tag_labels).split(",") : [],
    tag_labels: undefined,
  });
});

// Stream the original PDF file with HTTP Range support (for the in-browser viewer).
documentRoutes.get("/:id/pdf", (c) => {
  const row = db()
    .prepare("SELECT stored_path, mime_type, filename FROM documents WHERE id = ?")
    .get(c.req.param("id")) as
    | { stored_path: string; mime_type: string; filename: string }
    | undefined;
  if (!row) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  const { createReadStream, existsSync, statSync } = require("fs") as typeof import("fs");
  const fullPath = fromDataPath(row.stored_path);
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.fileMissing") }, 404);

  const stat = statSync(fullPath);
  const range = c.req.header("range");
  // Sanitize the stored filename for the header — quotes or CR/LF in
  // a legacy DB row would otherwise break out of the header value.
  const headerName =
    row.filename.replace(/[\x00-\x1f"\\]/g, "").trim() || "document.pdf";
  const baseHeaders: Record<string, string> = {
    "Content-Type": row.mime_type || "application/pdf",
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="${headerName}"`,
  };
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start < stat.size && end >= start && end < stat.size) {
        const headers = {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": String(end - start + 1),
        };
        const body = createReadStream(fullPath, { start, end }) as any;
        return new Response(body, { status: 206, headers });
      }
    }
  }
  const headers = { ...baseHeaders, "Content-Length": String(stat.size) };
  const body = createReadStream(fullPath) as any;
  return new Response(body, { status: 200, headers });
});

// Upload
documentRoutes.post("/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  const language = (form.get("language") as string) || "de";
  const type = (form.get("type") as string) || "studienheft";
  const tags = (form.get("tags") as string) || "";
  // Optional module assignment. Empty string and "none" both map to
  // NULL (no module). We do NOT validate that the module exists — if
  // the user picked one that was just deleted, the FK is permissive
  // (column allows NULL on delete-cascade).
  const moduleRaw = (form.get("module") as string) || "";
  const moduleId =
    moduleRaw === "" || moduleRaw === "none" ? null : moduleRaw;
  // Opt-in: re-OCR every page even when extractable text exists. Rescues
  // PDFs with broken font CMaps (/gNN glyph soup in the text layer).
  const forceOcr =
    String(form.get("force_ocr") ?? "").toLowerCase() === "true" ? 1 : 0;

  if (!file) return c.json({ error: tt(c, "err.missingFile") }, 400);

  // The multipart filename is client-controlled — strip any path
  // component so "../../evil.pdf" can't escape the upload directory,
  // and drop control chars/quotes that would later break the
  // Content-Disposition header when streaming the PDF back.
  const safeName =
    basename(file.name).replace(/[\x00-\x1f"\\]/g, "").trim() || "upload.pdf";

  const id = randomUUID();
  const dir = join(UPLOAD_DIR, id);
  mkdirSync(dir, { recursive: true });

  const buf = Buffer.from(await file.arrayBuffer());
  const stored = join(dir, safeName);
  writeFileSync(stored, buf);

  const relPath = join("uploads", id, safeName);
  const title = safeName.replace(/\.[^.]+$/, "");

  db()
    .prepare(
      `INSERT INTO documents (id, title, filename, stored_path, mime_type, size_bytes, language, type, module_id, force_ocr, ocr_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting-extraction')`
    )
    .run(
      id,
      title,
      safeName,
      relPath,
      file.type || "application/pdf",
      buf.length,
      language,
      type,
      moduleId,
      forceOcr
    );

  // Tags
  if (tags.trim()) {
    const d = db();
    for (const label of tags.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      d.prepare("INSERT OR IGNORE INTO tags (label) VALUES (?)").run(label);
      const tag = d.prepare("SELECT id FROM tags WHERE label = ?").get(label) as { id: number };
      d.prepare("INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)").run(id, tag.id);
    }
  }

  // Extraction does NOT start automatically — the user triggers it
  // explicitly via POST /:id/reprocess when ready (docling runs can
  // take a good half hour on the NAS).

  return c.json({ id, title, filename: safeName }, 201);
});

// Start (or re-run) Docling extraction. Manually triggered even for
// the first run — uploads only set status "awaiting-extraction".
documentRoutes.post("/:id/reprocess", async (c) => {
  const id = c.req.param("id");
  const doc = db().prepare("SELECT id FROM documents WHERE id = ?").get(id);
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  // Allow flipping force_ocr at re-run time without re-uploading the
  // file. Common flow: first extraction shows /gNN garbage → user
  // re-triggers with force_ocr=true.
  const forceOcrRaw = c.req.query("force_ocr");
  if (forceOcrRaw !== undefined) {
    const v = forceOcrRaw.toLowerCase() === "true" ? 1 : 0;
    db().prepare("UPDATE documents SET force_ocr = ? WHERE id = ?").run(v, id);
  }
  processDocument(id).catch((err) => console.error("[reprocess] pipeline error:", err));
  return c.json({ status: "queued" });
});

// Cancel a running extraction.
documentRoutes.post("/:id/extract/cancel", (c) => {
  const id = c.req.param("id");
  const ok = cancelProcessing(id);
  return c.json({ status: ok ? "canceling" : "not-running" });
});

// Delete
documentRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const doc = db().prepare("SELECT stored_path FROM documents WHERE id = ?").get(id) as { stored_path: string } | undefined;
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  const fullPath = fromDataPath(doc.stored_path);
  if (existsSync(fullPath)) unlinkSync(fullPath);

  // Remove per-document folders (upload dir + any generated audio).
  const uploadDir = join(DATA_DIR, "uploads", id);
  if (existsSync(uploadDir)) rmSync(uploadDir, { recursive: true, force: true });
  const audioDir = join(DATA_DIR, "audio", id);
  if (existsSync(audioDir)) rmSync(audioDir, { recursive: true, force: true });

  db().prepare("DELETE FROM documents WHERE id = ?").run(id);
  removeFromIndex(id).catch(() => {});
  return c.json({ status: "ok" });
});

// Update (title, tags, type, module_id)
documentRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    title?: string;
    type?: string;
    tags?: string[];
    module_id?: string | null;
    thumb_page?: number;
    author?: string | null;
    short_code?: string | null;
    series_sequence?: string | null;
  }>();

  const doc = db().prepare("SELECT id, page_count FROM documents WHERE id = ?").get(id) as
    | { id: string; page_count: number }
    | undefined;
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);

  if (body.title !== undefined) {
    db().prepare("UPDATE documents SET title = ? WHERE id = ?").run(body.title, id);
  }
  if (body.type !== undefined) {
    db().prepare("UPDATE documents SET type = ? WHERE id = ?").run(body.type, id);
  }
  if (body.module_id !== undefined) {
    // Von Hand gesetzt: die Pipeline überschreibt es nicht mehr
    db().prepare("UPDATE documents SET module_id = ?, assign_confidence = 'manuell' WHERE id = ?").run(body.module_id, id);
  }
  if (body.thumb_page !== undefined) {
    const max = doc.page_count > 0 ? doc.page_count : Number.MAX_SAFE_INTEGER;
    const clamped = Math.max(1, Math.min(max, Math.floor(body.thumb_page)));
    db().prepare("UPDATE documents SET thumb_page = ? WHERE id = ?").run(clamped, id);
  }
  if (body.author !== undefined) {
    // null or empty string → reset column to NULL, otherwise trim
    // and store. Lets the user delete an accidentally wrong author
    // pulled by extraction.
    const value =
      body.author === null || body.author.trim().length === 0
        ? null
        : body.author.trim();
    db().prepare("UPDATE documents SET author = ? WHERE id = ?").run(value, id);
  }
  if (body.short_code !== undefined) {
    const value =
      body.short_code === null || body.short_code.trim().length === 0
        ? null
        : body.short_code.trim();
    db().prepare("UPDATE documents SET short_code = ? WHERE id = ?").run(value, id);
  }
  if (body.series_sequence !== undefined) {
    // String fields, weil ABS auch "1.5" / "1a" akzeptiert. Trim +
    // null bei leer.
    const value =
      body.series_sequence === null ||
      body.series_sequence.trim().length === 0
        ? null
        : body.series_sequence.trim();
    db()
      .prepare("UPDATE documents SET series_sequence = ? WHERE id = ?")
      .run(value, id);
  }
  if (body.tags !== undefined) {
    const d = db();
    d.prepare("DELETE FROM document_tags WHERE document_id = ?").run(id);
    for (const label of body.tags.map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      d.prepare("INSERT OR IGNORE INTO tags (label) VALUES (?)").run(label);
      const tag = d.prepare("SELECT id FROM tags WHERE label = ?").get(label) as { id: number };
      d.prepare("INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)").run(id, tag.id);
    }
  }

  const updated = db().prepare("SELECT * FROM documents WHERE id = ?").get(id);
  return c.json(updated);
});
