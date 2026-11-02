// Cover-Standard für alle Hefte ohne eigene Wahl, mit Vorschau am zuletzt hochgeladenen Heft
import { Hono } from "hono";
import { db } from "../db";
import { defaultCover, ensureCover, isCoverChoice, isCoverKind, setDefaultCover } from "../services/covers";

export const coverRoutes = new Hono();

coverRoutes.get("/default", (c) => c.json({ style: defaultCover() }));

coverRoutes.put("/default", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { style?: unknown };
  if (!isCoverChoice(body.style)) return c.json({ error: "Unbekannte Vorlage" }, 400);
  setDefaultCover(body.style);
  return c.json({ style: defaultCover() });
});

// Vorschau einer Vorlage am neuesten Heft (echter Titel und Modulfarbe); ohne Heft 404
coverRoutes.get("/sample", async (c) => {
  const style = c.req.query("style");
  const kind = c.req.query("kind") || "original";
  if (!isCoverChoice(style) || !isCoverKind(kind)) return c.json({ error: "Unbekannte Vorlage" }, 400);
  const doc = db().prepare("SELECT id FROM documents ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
  const path = doc ? await ensureCover(doc.id, kind, style) : undefined;
  if (!path) return c.json({ error: "Noch kein Heft für die Vorschau" }, 404);
  return new Response(Bun.file(path), { headers: { "Content-Type": path.endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "no-cache" } });
});
