import { Hono } from "hono";
import { join } from "path";
import { createReadStream, existsSync, statSync } from "fs";
import { db } from "../db";
import { feedToken, verifyFeedToken } from "../services/feedToken";
import { tt } from "../lib/i18n";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";

/** Authentifizierte Token-Anfrage. Liefert die komplette Feed-URL. */
export const feedApiRoutes = new Hono();

feedApiRoutes.get("/token", (c) => {
  const token = feedToken();
  const origin = resolveOrigin(c.req);
  return c.json({
    token,
    baseUrl: `${origin}/feed/${token}`,
    note:
      "Füge pro Dokument den individuellen Podcast-Feed in Apple Podcasts oder Overcast hinzu. URL enthält ein Token — bei Passwort-Änderung werden alle Feeds ungültig.",
  });
});

feedApiRoutes.get("/urls/:docId", (c) => {
  const docId = c.req.param("docId");
  const doc = db()
    .prepare("SELECT id, title FROM documents WHERE id = ?")
    .get(docId) as { id: string; title: string } | undefined;
  if (!doc) return c.json({ error: tt(c, "err.docNotFound") }, 404);
  const origin = resolveOrigin(c.req);
  const token = feedToken();
  return c.json({
    title: doc.title,
    feedUrl: `${origin}/feed/${token}/${docId}.xml`,
    m4bUrl: `${origin}/feed/${token}/${docId}.m4b`,
  });
});

/** Öffentliche, token-geschützte Routen (NICHT hinter authMiddleware). */
export const feedPublicRoutes = new Hono();

feedPublicRoutes.get("/:token/:docId.xml", (c) => {
  const token = c.req.param("token") ?? "";
  if (!verifyFeedToken(token)) {
    return c.text("Invalid token", 403);
  }
  const docId = c.req.param("docId") ?? "";
  const doc = db()
    .prepare(
      "SELECT id, title, language, filename, created_at FROM documents WHERE id = ?"
    )
    .get(docId) as
    | { id: string; title: string; language: string; filename: string; created_at: string }
    | undefined;
  if (!doc) return c.text("Not found", 404);

  const rows = db()
    .prepare(
      `SELECT a.id, a.stored_path, a.duration_ms, a.status,
              c.title as chapter_title, c.number as chapter_number, c.start_page
       FROM audio a
       JOIN chapters c ON c.id = a.chapter_id
       WHERE c.document_id = ? AND a.status = 'done'
       ORDER BY c.sort_order ASC, c.number ASC`
    )
    .all(docId) as Array<{
    id: string;
    stored_path: string;
    duration_ms: number;
    status: string;
    chapter_title: string;
    chapter_number: number;
    start_page: number;
  }>;

  const origin = resolveOrigin(c.req);
  const xml = renderRss({
    doc,
    episodes: rows,
    origin,
    token,
    docId,
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
});

feedPublicRoutes.get("/:token/audio/:audioId.mp3", (c) => {
  if (!verifyFeedToken(c.req.param("token") ?? "")) {
    return c.text("Invalid token", 403);
  }
  const row = db()
    .prepare("SELECT stored_path, status FROM audio WHERE id = ?")
    .get(c.req.param("audioId") ?? "") as { stored_path: string; status: string } | undefined;
  if (!row || row.status !== "done") return c.text("Not ready", 404);
  const full = join(DATA_DIR, row.stored_path);
  if (!existsSync(full)) return c.text("File missing", 404);
  return serveWithRange(c, full, "audio/mpeg");
});

feedPublicRoutes.get("/:token/:docId.m4b", (c) => {
  if (!verifyFeedToken(c.req.param("token") ?? "")) {
    return c.text("Invalid token", 403);
  }
  const full = join(DATA_DIR, "audio", c.req.param("docId") ?? "", "book.m4b");
  if (!existsSync(full)) return c.text("Not ready", 404);
  return serveWithRange(c, full, "audio/mp4", "book.m4b");
});

function serveWithRange(c: any, fullPath: string, mime: string, download?: string): Response {
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
        return new Response(createReadStream(fullPath, { start, end }) as any, {
          status: 206,
          headers,
        });
      }
    }
  }
  headers["Content-Length"] = String(stat.size);
  return new Response(createReadStream(fullPath) as any, { status: 200, headers });
}

function resolveOrigin(req: { url: string; header: (name: string) => string | undefined }): string {
  const forwardedProto = req.header("x-forwarded-proto");
  const forwardedHost = req.header("x-forwarded-host");
  if (forwardedProto && forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  try {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://localhost:3000";
  }
}

function renderRss(params: {
  doc: { id: string; title: string; language: string; filename: string; created_at: string };
  episodes: Array<{
    id: string;
    duration_ms: number;
    chapter_title: string;
    chapter_number: number;
    start_page: number;
  }>;
  origin: string;
  token: string;
  docId: string;
}): string {
  const { doc, episodes, origin, token, docId } = params;
  const feedUrl = `${origin}/feed/${token}/${docId}.xml`;
  const podcastLang = doc.language === "en" ? "en-us" : "de-de";

  const items = episodes
    .map((ep) => {
      const enclosureUrl = `${origin}/feed/${token}/audio/${ep.id}.mp3`;
      const durationSec = Math.max(1, Math.round(ep.duration_ms / 1000));
      const pubDate = new Date(Date.now() - (episodes.length - ep.chapter_number) * 60_000).toUTCString();
      const title = `${String(ep.chapter_number).padStart(2, "0")} · ${ep.chapter_title || `Kapitel ${ep.chapter_number}`}`;
      const guid = `pm-${docId}-${ep.id}`;
      return `  <item>
    <title>${escapeXml(title)}</title>
    <guid isPermaLink="false">${guid}</guid>
    <pubDate>${pubDate}</pubDate>
    <itunes:duration>${durationSec}</itunes:duration>
    <itunes:episode>${ep.chapter_number}</itunes:episode>
    <itunes:episodeType>full</itunes:episodeType>
    <enclosure url="${enclosureUrl}" length="0" type="audio/mpeg"/>
    <description>${escapeXml(`Seite ${ep.start_page}`)}</description>
  </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${escapeXml(doc.title)}</title>
  <link>${origin}</link>
  <atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>
  <description>${escapeXml(`PageMentor-Hörbuch zu ${doc.filename}`)}</description>
  <language>${podcastLang}</language>
  <itunes:author>PageMentor</itunes:author>
  <itunes:summary>${escapeXml(`Vorlesungs-PDF als Hörbuch. Generiert von PageMentor.`)}</itunes:summary>
  <itunes:category text="Education"/>
  <itunes:explicit>false</itunes:explicit>
  <itunes:type>serial</itunes:type>
  <itunes:block>Yes</itunes:block>
  <itunes:owner>
    <itunes:name>PageMentor</itunes:name>
    <itunes:email>no-reply@pagementor.local</itunes:email>
  </itunes:owner>
${items}
</channel>
</rss>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
