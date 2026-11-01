// Lernhörbuch: Einstellungen am Heft, Einheiten mit Skripten, Lauf starten (Probe oder ganzes Heft) und abbrechen
import { existsSync } from "node:fs";
import { Hono } from "hono";
import { db } from "../db";
import { learnSettings, listUnits } from "../services/learnbook/store";
import { cancelLearnbook, learnState, startLearnbook, uploadLearnbook } from "../services/learnbook/run";
import { learnBookPath } from "../services/learnbook/speak";
import { learnFileSuffix } from "../services/learnbook/meta";
import { bookFileName } from "../services/audiobook/export";
import { absEnabled } from "../services/llmConfig";
import { absReady } from "../services/audiobookshelf";
import { learnModel } from "../services/learnbook/script";

export const learnbookRoutes = new Hono();

learnbookRoutes.get("/:docId", async (c) => {
  const docId = c.req.param("docId");
  const settings = learnSettings(docId);
  const units = listUnits(docId).map((u) => ({
    idx: u.idx,
    title: u.title,
    startPage: u.start_page,
    endPage: u.end_page,
    script: u.script,
    points: u.points ? (JSON.parse(u.points) as string[]) : [],
    checkNote: u.check_note,
    model: u.model,
    hasAudio: !!u.audio_path,
    durationMs: u.duration_ms,
  }));
  return c.json({
    ...settings,
    model: (await learnModel(settings.kind)).model ?? null,
    units,
    state: learnState(docId),
    hasBook: existsSync(learnBookPath(docId)),
    abs: absEnabled() && absReady(),
  });
});

learnbookRoutes.put("/:docId", async (c) => {
  const body = (await c.req.json()) as { kind?: string; lang?: string };
  const kind = body.kind === "language" || body.kind === "subject" ? body.kind : null;
  db().prepare("UPDATE documents SET learn_kind = COALESCE(?, learn_kind), learn_lang = COALESCE(?, learn_lang) WHERE id = ?").run(kind, body.lang || null, c.req.param("docId"));
  return c.json(learnSettings(c.req.param("docId")));
});

learnbookRoutes.post("/:docId/start", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { probe?: boolean; rate?: string };
  return c.json(startLearnbook(c.req.param("docId"), !!body.probe, body.rate || "+0%"));
});

learnbookRoutes.post("/:docId/cancel", (c) => {
  cancelLearnbook(c.req.param("docId"));
  return c.json(learnState(c.req.param("docId")));
});

// Fertiges Lernhörbuch herunterladen, Dateiname mit Zusatz wie im Hörbücher-Ordner
learnbookRoutes.get("/:docId/book", (c) => {
  const docId = c.req.param("docId");
  const path = learnBookPath(docId);
  if (!existsSync(path)) return c.json({ error: "Noch kein Lernhörbuch" }, 404);
  const name = bookFileName(docId).replace(/\.m4b$/i, `${learnFileSuffix(learnSettings(docId).kind)}.m4b`);
  return new Response(Bun.file(path), {
    headers: { "Content-Type": "audio/mp4", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
  });
});

// Fertiges Lernhörbuch nachträglich zu Audiobookshelf (eigener Eintrag neben dem Original)
learnbookRoutes.post("/:docId/abs", async (c) => {
  try {
    return c.json(await uploadLearnbook(c.req.param("docId")));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// Audio einer Einheit zum Anhören in der App
learnbookRoutes.get("/:docId/unit/:idx/audio", (c) => {
  const u = listUnits(c.req.param("docId")).find((x) => x.idx === Number(c.req.param("idx")));
  if (!u?.audio_path || !existsSync(u.audio_path)) return c.json({ error: "Noch kein Audio" }, 404);
  return new Response(Bun.file(u.audio_path), { headers: { "Content-Type": "audio/mpeg" } });
});
