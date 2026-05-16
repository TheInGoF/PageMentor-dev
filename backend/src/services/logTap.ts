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
  // Error-state machine. We collapse the noisy "HTTP 503" / "operation
  // timed out" alternation into ONE family ("unreachable") and only
  // re-log it every REPEAT_NOTICE_MS while it's persisting.
  //
  // States: null = healthy, "404" = endpoint missing on this build,
  // "unreachable" = transient or persistent failure.
  let errorKind: null | "404" | "unreachable" = null;
  let errorSince = 0;
  let lastErrorLogAt = 0;
  let lastErrorDetail = "";
  const REPEAT_NOTICE_MS = 5 * 60 * 1000;

  function classifyError(msg: string): "404" | "unreachable" {
    if (/HTTP 404\b/.test(msg)) return "404";
    return "unreachable";
  }

  function noteError(detail: string) {
    const kind = classifyError(detail);
    const now = Date.now();
    if (errorKind !== kind) {
      // New error class — log immediately, start the "still down" clock.
      errorKind = kind;
      errorSince = now;
      lastErrorLogAt = now;
      lastErrorDetail = detail;
      if (kind === "404") {
        publish({
          ts: now,
          source: "system",
          level: "warn",
          message:
            "[sidecar-log-pump] sidecar/arbiter has no /diagnostics/recent-logs endpoint — upgrade to a newer image to see live sidecar logs",
        });
      } else {
        publish({
          ts: now,
          source: "system",
          level: "warn",
          message:
            `[sidecar-log-pump] sidecar unreachable (${detail}) — ` +
            `if this persists, restart pm-gpu-arbiter / pm-qwen-tts on the GPU host ` +
            `(or trigger the GPU reset from PageMentor's admin endpoint).`,
        });
      }
      return;
    }
    // Same class — update the most recent detail for the next reminder,
    // but stay silent unless REPEAT_NOTICE_MS has elapsed.
    lastErrorDetail = detail;
    if (kind === "unreachable" && now - lastErrorLogAt >= REPEAT_NOTICE_MS) {
      const downForS = Math.round((now - errorSince) / 1000);
      publish({
        ts: now,
        source: "system",
        level: "warn",
        message:
          `[sidecar-log-pump] still down for ${downForS}s (latest: ${detail}). ` +
          `Recommend GPU swap: docker restart pm-gpu-arbiter pm-qwen-tts on the GPU host.`,
      });
      lastErrorLogAt = now;
    }
  }

  function noteRecovery() {
    if (errorKind === null) return;
    const downForS = Math.round((Date.now() - errorSince) / 1000);
    publish({
      ts: Date.now(),
      source: "system",
      level: "info",
      message:
        `[sidecar-log-pump] reconnected after ${downForS}s ` +
        `(last error: ${lastErrorDetail || "unknown"}).`,
    });
    errorKind = null;
    errorSince = 0;
    lastErrorLogAt = 0;
    lastErrorDetail = "";
  }

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
        if (res.status === 404) {
          noteError("HTTP 404");
          // 404 means the endpoint is missing on this build; back off
          // hard so we don't spam.
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
      noteRecovery();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      noteError(msg);
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
