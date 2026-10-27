import { Hono } from "hono";
import { join } from "path";
import { existsSync, createReadStream, statSync } from "fs";
import { db } from "../../db";
import { DATA_DIR, fromDataPath } from "../../paths";
import { tt } from "../../lib/i18n";
import { bookFileName, exportBook, exportedBookPath, revealInFolder } from "../../services/audiobook/export";

export const fileRoutes = new Hono();

// Kapitel-MP3 mit HTTP Range streamen
fileRoutes.get("/file/:audioId", (c) => {
  const row = db().prepare("SELECT stored_path, status FROM audio WHERE id = ?").get(c.req.param("audioId")) as
    | { stored_path: string; status: string }
    | undefined;
  if (!row || row.status !== "done") return c.json({ error: tt(c, "err.notReady") }, 404);

  const fullPath = fromDataPath(row.stored_path);
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.fileMissing") }, 404);

  return serveFileWithRange(c, fullPath, "audio/mpeg");
});

// Ganzes Buch als M4B, Dateiname aus dem Dokumenttitel
fileRoutes.get("/book/:docId", (c) => {
  const docId = c.req.param("docId");
  const fullPath = join(DATA_DIR, "audio", docId, "book.m4b");
  if (!existsSync(fullPath)) return c.json({ error: tt(c, "err.notReady") }, 404);
  const downloadName = bookFileName(docId);
  return serveFileWithRange(c, fullPath, "audio/mp4", downloadName);
});

// Fertiges Hörbuch im Explorer zeigen
fileRoutes.post("/reveal/:docId", (c) => {
  const docId = c.req.param("docId");
  const path = exportedBookPath(docId);
  if (!existsSync(path) && !exportBook(docId)) return c.json({ error: tt(c, "err.notReady") }, 404);
  return c.json({ path, opened: revealInFolder(path) });
});

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
