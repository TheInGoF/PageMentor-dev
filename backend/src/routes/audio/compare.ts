// Engine-Vergleich: starten, Stand abfragen, Ergebnis abspielen
import { Hono } from "hono";
import { readFileSync } from "fs";
import { compareFile, compareRun, startCompare } from "../../services/audiobook/compare";

export const compareRoutes = new Hono();

compareRoutes.post("/compare/:docId", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { chapterId?: string; voices?: string[] };
  if (!body.chapterId || !body.voices?.length) return c.json({ error: "chapterId und voices nötig" }, 400);
  try {
    return c.json(startCompare(c.req.param("docId"), body.chapterId, body.voices));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 409);
  }
});

compareRoutes.get("/compare/:docId", (c) => c.json({ run: compareRun(c.req.param("docId")) }));

// Proben sind kurz, ohne Range
compareRoutes.get("/compare/:docId/file/:engine", (c) => {
  const p = compareFile(c.req.param("docId"), c.req.param("engine"));
  if (!p) return c.json({ error: "nicht vorhanden" }, 404);
  return new Response(readFileSync(p), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
});
