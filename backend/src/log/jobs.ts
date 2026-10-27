// Hintergrund-Jobs: eigene jobId, Start, Ende, Fehler mit Dauer
import { currentContext, newId, withLogContext } from "./context";
import { logger } from "./logger";
import type { LogContext } from "./types";

export function runJob<T>(kind: string, area: string, ctx: LogContext, fn: () => Promise<T>): Promise<T> {
  // Verschachtelte Jobs behalten die äußere jobId
  const jobId = currentContext().jobId ?? newId(kind);
  return withLogContext({ ...ctx, jobId }, async () => {
    const log = logger(area);
    const t0 = performance.now();
    log.info(`Job ${kind} gestartet`);
    try {
      const result = await fn();
      log.info(`Job ${kind} beendet`, { durationMs: Math.round(performance.now() - t0) });
      return result;
    } catch (err) {
      log.error(`Job ${kind} fehlgeschlagen`, err, { durationMs: Math.round(performance.now() - t0) });
      throw err;
    }
  });
}
