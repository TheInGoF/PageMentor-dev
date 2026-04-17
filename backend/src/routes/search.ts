import { Hono } from "hono";
import { search, ensureReady, isReady } from "../services/search";

export const searchRoutes = new Hono();

searchRoutes.get("/", async (c) => {
  const q = (c.req.query("q") || "").trim();
  const limit = Math.min(25, Math.max(1, parseInt(c.req.query("limit") || "10", 10)));
  if (!q) return c.json({ documents: [], chapters: [], enabled: isReady() });
  const res = await search(q, limit);
  return c.json(res);
});

searchRoutes.get("/status", async (c) => {
  const ok = await ensureReady();
  return c.json({ enabled: ok });
});
