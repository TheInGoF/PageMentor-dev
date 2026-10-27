// Eingehende API-Anfragen loggen, Fehler vollständig erfassen
import type { Context, MiddlewareHandler } from "hono";
import { newId, withLogContext } from "./context";
import { emitLog } from "./logger";

// Live-Streams und Log-Abfragen nicht protokollieren
const QUIET = [/\/stream(\/|$)/, /^\/api\/logs/, /^\/api\/health$/, /^\/api\/auth\/check$/];

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;
  if (!path.startsWith("/api/")) return next();
  return withLogContext({ reqId: newId("req") }, async () => {
    const t0 = performance.now();
    await next();
    const status = c.res.status;
    if (status < 400 && QUIET.some((re) => re.test(path))) return;
    const durationMs = Math.round(performance.now() - t0);
    // 401 = nicht angemeldet, erwartet
    const level = status >= 500 ? "error" : status >= 400 && status !== 401 ? "warn" : "debug";
    emitLog(level, "http", `${c.req.method} ${path} → ${status} (${durationMs} ms)`, {
      ctx: { status, durationMs },
    });
  });
};

// Unbehandelte Fehler in Routen: loggen und sauber antworten
export function onRouteError(err: Error, c: Context) {
  emitLog("error", "http", `${c.req.method} ${c.req.path}: unbehandelter Fehler`, { err });
  return c.json({ error: err.message || "Interner Fehler" }, 500);
}
