/**
 * Wires backend `console.*` and sidecar log polling into the logBus.
 *
 * Goals:
 *   - Every `console.log/info/warn/error` written by backend code lands
 *     in the LogsPage SSE stream automatically (no callsite changes).
 *   - The sidecar's recent log lines are pulled every 5 s and merged
 *     into the same stream so the user sees backend + sidecar
 *     interleaved by timestamp.
 *
 * Both are best-effort: if the sidecar is unreachable we just keep
 * trying; the original `console.*` call still goes to stderr/stdout
 * regardless, so we never lose log data.
 */

import { publish, type LogLevel } from "./logBus";
import { effective } from "./llmConfig";

let installed = false;

/** Replace `console.*` so each call goes to both stderr (as before)
 *  and the in-memory log bus. Call once at process start. */
export function installLogTap(): void {
  if (installed) return;
  installed = true;
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const wrap = (level: LogLevel, original: (...a: unknown[]) => void) => {
    return (...args: unknown[]) => {
      original(...args);
      try {
        publish({
          ts: Date.now(),
          source: "pm-app",
          level,
          message: args
            .map((a) => (typeof a === "string" ? a : safeStringify(a)))
            .join(" "),
        });
      } catch {
        // swallow — never let logging break the caller
      }
    };
  };
  console.log = wrap("info", originals.log);
  console.info = wrap("info", originals.info);
  console.warn = wrap("warn", originals.warn);
  console.error = wrap("error", originals.error);
  console.debug = wrap("debug", originals.debug);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

interface SidecarLine {
  ts: number;
  level: string;
  message: string;
}

/** Polls the sidecar's `/diagnostics/recent-logs` endpoint every
 *  `intervalMs` and republishes new lines on the log bus. The
 *  sidecar's ring buffer keeps its own `ts`, so we ask only for
 *  lines newer than the last we saw — no duplicates on each poll.
 *
 *  When the sidecar is unreachable (no URL configured, network
 *  down, container restarting), the pump silently retries on the
 *  next tick. The first error after a healthy phase is reported
 *  to the bus once so the UI surfaces it; subsequent errors of the
 *  same kind are suppressed until something changes. */
export function startSidecarLogPump(intervalMs: number = 5000): () => void {
  let stopped = false;
  let sinceTs = 0;
  let lastError: string | null = null;

  async function tick() {
    if (stopped) return;
    const base = effective("qwenTtsUrl", "PM_QWEN_TTS_URL");
    if (!base) {
      // No sidecar configured — sleep silently.
      schedule();
      return;
    }
    try {
      const url =
        base.replace(/\/+$/, "") +
        "/diagnostics/recent-logs?since=" +
        sinceTs;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) {
        // Older arbiters / sidecars without the endpoint return 404;
        // that's fine, we just stop trying after a few rounds.
        if (res.status === 404) {
          if (lastError !== "404") {
            publish({
              ts: Date.now(),
              source: "system",
              level: "warn",
              message:
                "[sidecar-log-pump] sidecar/arbiter has no /diagnostics/recent-logs endpoint — upgrade to a newer image to see live sidecar logs",
            });
            lastError = "404";
          }
          schedule(intervalMs * 6);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        lines?: SidecarLine[];
        source?: string;
      };
      const source =
        (data.source as "qwen-tts" | "arbiter" | undefined) ?? "qwen-tts";
      const newest = data.lines ?? [];
      for (const l of newest) {
        if (l.ts <= sinceTs) continue;
        publish({
          ts: l.ts,
          source,
          level: normalizeLevel(l.level),
          message: l.message,
        });
        if (l.ts > sinceTs) sinceTs = l.ts;
      }
      if (lastError !== null) {
        publish({
          ts: Date.now(),
          source: "system",
          level: "info",
          message: "[sidecar-log-pump] reconnected",
        });
        lastError = null;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (lastError !== msg) {
        publish({
          ts: Date.now(),
          source: "system",
          level: "warn",
          message: "[sidecar-log-pump] " + msg,
        });
        lastError = msg;
      }
    }
    schedule();
  }

  function schedule(delay: number = intervalMs) {
    if (stopped) return;
    setTimeout(tick, delay);
  }

  schedule(2000); // first pull soon after boot
  return () => {
    stopped = true;
  };
}

function normalizeLevel(s: string): LogLevel {
  const l = (s ?? "").toLowerCase();
  if (l === "warning" || l === "warn") return "warn";
  if (l === "error" || l === "critical" || l === "fatal") return "error";
  if (l === "debug" || l === "trace") return "debug";
  return "info";
}
