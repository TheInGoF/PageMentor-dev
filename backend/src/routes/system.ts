// Leistungsanzeige der Diagnose: Verlauf von CPU, Arbeitsspeicher, Grafikkarte und Platte
import { Hono } from "hono";
import { systemStats } from "../services/system/monitor";

export const systemRoutes = new Hono();

systemRoutes.get("/stats", (c) => c.json(systemStats(), 200, { "Cache-Control": "no-store" }));
