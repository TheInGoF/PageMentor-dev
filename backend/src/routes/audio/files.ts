import { Hono } from "hono";
import { join } from "path";
import { existsSync, createReadStream, statSync } from "fs";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { tt } from "../../lib/i18n";

export const fileRoutes = new Hono();

// Kapitel-MP3 mit HTTP Range streamen
fileRoutes.get("/file/:audioId", (c) => {
  const row = db().prepare("SELECT stored_path, status FROM audio WHERE id = ?").get(c.req.param("audioId")) as
    | { stored_path: string; status: string }
    | undefined;
  if (!row || row.status !== "done") return c.json({ error: tt(c, "err.notReady") }, 404);

  const fullPath = join(DATA_DIR, row.stored_path);
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.fileMissing") }, 404);

  return serveFileWithRange(c, fullPath, "audio/mpeg");
});

// Ganzes Buch als M4B, Dateiname aus dem Dokumenttitel
fileRoutes.get("/book/:docId", (c) => {
  const docId = c.req.param("docId");
  const fullPath = join(DATA_DIR, "audio", docId, "book.m4b");
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.notReady") }, 404);
  const doc = db()
    .prepare(
      "SELECT title, doc_title, author, short_code FROM documents WHERE id = ?"
    )
    .get(docId) as
    | {
        title: string;
        doc_title: string | null;
        author: string | null;
        short_code: string | null;
      }
    | undefined;
  const baseTitle = doc?.doc_title?.trim() || doc?.title || "audiobook";
  // Kürzel_Autor_Titel, leere Teile weglassen
  const parts = [
    doc?.short_code?.trim(),
    doc?.author?.trim(),
    baseTitle,
  ]
    .map((s) => (s ? safeFilename(s) : ""))
    .filter((s) => s.length > 0);
  const downloadName = `${parts.join("_")}.m4b`;
  return serveFileWithRange(c, fullPath, "audio/mp4", downloadName);
});

// Titel für Dateinamen und Header säubern
// Umlaute ausschreiben, Sonderzeichen → _, max. 120 Zeichen
function safeFilename(s: string): string {
  return s
    .replace(/ä/g, "ae").replace(/Ä/g, "Ae")
    .replace(/ö/g, "oe").replace(/Ö/g, "Oe")
    .replace(/ü/g, "ue").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}\- ]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "audiobook";
}


export function serveFileWithRange(c: any, fullPath: string, mime: string, download?: string): Response {
  const stat = statSync(fullPath);
  const range = c.req.header("range");

  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download}"`;

  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start < stat.size && end >= start && end < stat.size) {
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
        headers["Content-Length"] = String(end - start + 1);
        // @ts-ignore — Node streams are compatible with Fetch Response bodies in Bun
        const body = createReadStream(fullPath, { start, end });
        return new Response(body as any, { status: 206, headers });
      }
    }
  }

  headers["Content-Length"] = String(stat.size);
  // @ts-ignore
  const body = createReadStream(fullPath);
  return new Response(body as any, { status: 200, headers });
}
