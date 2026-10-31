// Ausspracheprüfung (Debug): Kapitel abhören lassen, Befunde ansehen, anhören, lösen oder ignorieren
import { Hono } from "hono";
import { spawn } from "node:child_process";
import { db } from "../db";
import { fromDataPath } from "../paths";
import { toolPath } from "../tools";
import { chapterOverview, getIssue, listIssues, setIssueStatus } from "../services/pronCheck/store";
import { cancelPronCheck, pronRunState, startPronCheck } from "../services/pronCheck/run";
import { sttAvailable } from "../services/pronCheck/stt";
import { enqueueLearn } from "../services/pronCheck/learn";
import { refreshExtraStatus } from "../tts/engines/extra/probe";

export const pronCheckRoutes = new Hono();

// Hefte mit fertigem Hörbuch-Audio
pronCheckRoutes.get("/docs", async (c) => {
  await refreshExtraStatus().catch(() => undefined);
  const docs = db()
    .prepare(
      `SELECT d.id, d.title, d.doc_title, d.language,
              (SELECT COUNT(*) FROM pron_issues i WHERE i.document_id = d.id AND i.status = 'open') AS open
         FROM documents d WHERE EXISTS (SELECT 1 FROM chapters c JOIN audio a ON a.chapter_id = c.id AND a.status = 'done' WHERE c.document_id = d.id)
        ORDER BY d.title COLLATE NOCASE`
    )
    .all();
  return c.json({ available: sttAvailable(), docs, state: pronRunState() });
});

pronCheckRoutes.get("/doc/:docId", (c) => {
  const docId = c.req.param("docId");
  return c.json({ chapters: chapterOverview(docId), issues: listIssues(docId), state: pronRunState() });
});

pronCheckRoutes.post("/doc/:docId/run", async (c) => {
  const docId = c.req.param("docId");
  const body = (await c.req.json().catch(() => ({}))) as { chapterIds?: string[] };
  const ids = body.chapterIds?.length ? body.chapterIds : chapterOverview(docId).filter((ch) => ch.hasAudio).map((ch) => ch.id);
  if (!sttAvailable()) return c.json({ error: "Whisper ist nicht eingeschaltet (Einstellungen → Engine → Stimm-Engines)" }, 409);
  return c.json(startPronCheck(docId, ids));
});

pronCheckRoutes.post("/cancel", (c) => {
  cancelPronCheck();
  return c.json(pronRunState());
});

pronCheckRoutes.post("/issue/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { status?: string; note?: string };
  const status = body.status === "resolved" || body.status === "ignored" || body.status === "open" ? body.status : null;
  if (!status || !getIssue(c.req.param("id"))) return c.json({ error: "ungültig" }, 400);
  setIssueStatus(c.req.param("id"), status, body.note);
  // Nur der grüne Haken (gelöst) bringt Gemma etwas bei
  if (status === "resolved") enqueueLearn(c.req.param("id"));
  return c.json(getIssue(c.req.param("id")));
});

// Hörprobe der Stelle: etwas Vorlauf und Nachlauf, damit man den Zusammenhang hört
pronCheckRoutes.get("/issue/:id/audio", async (c) => {
  const issue = getIssue(c.req.param("id"));
  if (!issue) return c.json({ error: "nicht gefunden" }, 404);
  const a = db().prepare("SELECT stored_path FROM audio WHERE chapter_id = ? AND status = 'done'").get(issue.chapter_id) as { stored_path: string } | undefined;
  if (!a) return c.json({ error: "kein Audio" }, 404);
  const from = Math.max(0, issue.start - 1.5);
  const dur = Math.max(1.5, issue.end - issue.start) + 3;
  const child = spawn(toolPath("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-ss", from.toFixed(2), "-t", dur.toFixed(2), "-i", fromDataPath(a.stored_path), "-f", "mp3", "-"], {
    windowsHide: true,
  });
  const chunks: Buffer[] = [];
  for await (const d of child.stdout) chunks.push(d as Buffer);
  return new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { "Content-Type": "audio/mpeg" } });
});
