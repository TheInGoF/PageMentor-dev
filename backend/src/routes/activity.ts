// Warteschlange: alles, was gerade läuft oder auf die Grafikkarte wartet
import { Hono } from "hono";
import { activity, discardQueue, pausedQueue, removeQueueEntry, reorderQueue, resumeQueue } from "../services/activity";

export const activityRoutes = new Hono();
const answer = async () => ({ items: await activity(), paused: pausedQueue() });
activityRoutes.get("/", async (c) => c.json(await answer()));

// Hauptwarteschlange: Reihenfolge ändern, Eintrag entfernen (bricht den Auftrag ab)
activityRoutes.post("/reorder", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  reorderQueue(Array.isArray(body.ids) ? body.ids.map(String) : []);
  return c.json(await answer());
});
activityRoutes.post("/remove", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: string };
  removeQueueEntry(String(body.id ?? ""));
  return c.json(await answer());
});

// Nach dem Neustart: unterbrochene Aufträge fortsetzen oder verwerfen
activityRoutes.post("/resume", async (c) => {
  await resumeQueue();
  return c.json(await answer());
});
activityRoutes.post("/discard", async (c) => {
  discardQueue();
  return c.json(await answer());
});
