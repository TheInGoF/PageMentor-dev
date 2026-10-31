// Warteschlange: alles, was gerade läuft oder auf die Grafikkarte wartet
import { Hono } from "hono";
import { activity } from "../services/activity";

export const activityRoutes = new Hono();
activityRoutes.get("/", async (c) => c.json({ items: await activity() }));
