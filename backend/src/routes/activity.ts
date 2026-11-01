// Warteschlange: alles, was gerade läuft oder auf die Grafikkarte wartet
import { Hono } from "hono";
import { activity, removeQueueEntry, reorderQueue } from "../services/activity";

export const activityRoutes = new Hono();
activityRoutes.get("/", async (c) => c.json({ items: await activity() }));

// Hauptwarteschlange: Reihenfolge ändern, Eintrag entfernen (bricht den Auftrag ab)
activityRoutes.post("/reorder", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  reorderQueue(Array.isArray(body.ids) ? body.ids.map(String) : []);
  return c.json({ items: await activity() });
});
activityRoutes.post("/remove", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: string };
  removeQueueEntry(String(body.id ?? ""));
  return c.json({ items: await activity() });
});
