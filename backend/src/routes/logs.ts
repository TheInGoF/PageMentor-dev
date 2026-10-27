// Logs: Abfrage aus Dateien, Frontend-Fehler, Diagnosepaket
import { Hono } from "hono";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { LOG_DIR } from "../paths";
import { createDiagnosticBundle } from "../log/diagnostics";
import { listLogFiles, localDay } from "../log/files";
import { emitLog } from "../log/logger";
import { listDays, queryLogs } from "../log/query";
import type { LogLevel } from "../log/types";

export const logRoutes = new Hono();

const LEVELS = new Set(["debug", "info", "warn", "error"]);

logRoutes.get("/days", (c) => c.json({ days: listDays(), today: localDay() }));

logRoutes.get("/", (c) => {
  const q = c.req.query();
  const level = LEVELS.has(q.level ?? "") ? (q.level as LogLevel) : undefined;
  const result = queryLogs({
    day: q.day || localDay(),
    level,
    area: q.area || undefined,
    docId: q.docId || undefined,
    jobId: q.jobId || undefined,
    q: q.q || undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  return c.json(result);
});

logRoutes.get("/files", (c) => c.json({ dir: LOG_DIR, files: listLogFiles() }));

logRoutes.post("/diagnostics", async (c) => {
  const bundle = await createDiagnosticBundle();
  return c.json({ ...bundle, dir: LOG_DIR, url: `/api/logs/diagnostics/${bundle.name}` });
});

logRoutes.get("/diagnostics/:name", (c) => {
  const name = c.req.param("name");
  if (!/^diagnose-[\w-]+\.zip$/.test(name)) return c.json({ error: "ungültiger Name" }, 400);
  const path = join(LOG_DIR, name);
  if (!existsSync(path)) return c.json({ error: "nicht gefunden" }, 404);
  return new Response(readFileSync(path), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
});

// Frontend-Fehler, ohne Login erreichbar, begrenzt
export const clientLogRoutes = new Hono();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
let windowStart = 0;
let windowCount = 0;

clientLogRoutes.post("/", async (c) => {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  if (++windowCount > MAX_PER_WINDOW) return c.json({ ok: false, throttled: true }, 429);
  const body = (await c.req.json().catch(() => ({}))) as {
    level?: string;
    kind?: string;
    message?: string;
    stack?: string;
    componentStack?: string;
    url?: string;
    status?: number;
    path?: string;
  };
  const level: LogLevel = body.level === "warn" ? "warn" : "error";
  const message = String(body.message ?? "unbekannter Fehler").slice(0, 2000);
  const err = {
    name: `Frontend:${String(body.kind ?? "error").slice(0, 40)}`,
    message,
    stack: [body.stack, body.componentStack].filter(Boolean).join("\n--- Komponenten ---\n").slice(0, 8000) || undefined,
    status: typeof body.status === "number" ? body.status : undefined,
  };
  const where = [body.path, body.url].filter(Boolean).join(" @ ").slice(0, 300);
  emitLog(level, "ui", `${body.kind ?? "Fehler"}: ${message}${where ? ` (${where})` : ""}`, {
    err: Object.assign(new Error(message), err),
  });
  return c.json({ ok: true });
});
