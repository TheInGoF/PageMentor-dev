// Leistungsanzeige der Diagnose: Verlauf von CPU, Arbeitsspeicher, Grafikkarte und Platte
import { Hono } from "hono";
import { systemStats } from "../services/system/monitor";
import { cleanup } from "../services/cleanup";

export const systemRoutes = new Hono();

systemRoutes.get("/stats", (c) => c.json(systemStats(), 200, { "Cache-Control": "no-store" }));

// Aufräumen von Hand; ?dry=1 zählt nur
systemRoutes.post("/cleanup", async (c) => c.json(await cleanup({ dry: c.req.query("dry") === "1" })));
