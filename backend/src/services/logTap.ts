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

import { publish, type LogLevel, type LogSource } from "./logBus";
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
            `[sidecar-log-pump] /diagnostics/recent-logs endpoint not responding (${detail}). ` +
            `This does NOT mean the sidecar itself is dead — TTS / embed calls may still work. ` +
            `Only the live-log mirror into PageMentor's Logs page is affected. ` +
            `If TTS also actually fails, restart pm-gpu-arbiter / pm-qwen-tts on the GPU host.`,
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
          `[sidecar-log-pump] diagnostics endpoint still down for ${downForS}s (latest: ${detail}). ` +
          `Not necessarily a TTS outage — only the live-log mirror. ` +
          `Restart pm-gpu-arbiter / pm-qwen-tts only if TTS actually fails.`,
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

// ---------------------------------------------------------------------
// Docker-log-bridge pump (for docling and friends)
// ---------------------------------------------------------------------
//
// docling-serve has no /diagnostics/recent-logs endpoint like the
// arbiter, so we can't pump it the same way. Instead we run a tiny
// pm-docker-log-bridge container on the GPU host (mounts docker.sock
// read-only, exposes GET /logs/<container>?since=...) and pull from
// there. Generic over container name — pass it as a config field, the
// pump iterates over a list and publishes each container's lines with
// `source = <container_name>`.

interface DockerLogLine {
  ts: number;
  stream: "stdout" | "stderr";
  message: string;
}

/** Polls the docker-log-bridge for one specific container and
 *  republishes the lines on the log bus. Independent error-state
 *  tracking per container so a docling outage doesn't muddle the
 *  qwen-tts pump's state. */
function startDockerContainerPump(params: {
  bridgeBaseUrl: string;
  bridgeToken: string | undefined;
  container: string;
  source: string;
  intervalMs: number;
}): () => void {
  let stopped = false;
  let sinceTs = Date.now() - 60_000;
  let errorKind: null | "unreachable" = null;
  let errorSince = 0;
  let lastErrorLogAt = 0;
  let lastErrorDetail = "";
  const REPEAT_NOTICE_MS = 5 * 60 * 1000;

  async function tick() {
    if (stopped) return;
    const url =
      params.bridgeBaseUrl.replace(/\/+$/, "") +
      `/logs/${encodeURIComponent(params.container)}?since=${sinceTs}&tail=200`;
    try {
      const res = await fetch(url, {
        headers: params.bridgeToken
          ? { Authorization: `Bearer ${params.bridgeToken}` }
          : {},
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        container: string;
        lines: DockerLogLine[];
      };
      for (const l of data.lines ?? []) {
        if (l.ts <= sinceTs) continue;
        publish({
          ts: l.ts,
          // Container-name → known LogSource if we have a mapping,
          // else fall back to "system" to keep TS happy and avoid
          // surprising the UI with unknown source colours.
          source: mapContainerToSource(params.source),
          // Docker streams don't carry a level; everything from
          // stderr we treat as warn (matches docling's pattern where
          // INFO goes to stdout, errors/warns to stderr).
          level: l.stream === "stderr" ? "warn" : "info",
          message: l.message,
        });
        if (l.ts > sinceTs) sinceTs = l.ts;
      }
      if (errorKind !== null) {
        publish({
          ts: Date.now(),
          source: "system",
          level: "info",
          message:
            `[docker-log-bridge:${params.container}] reconnected after ` +
            `${Math.round((Date.now() - errorSince) / 1000)}s ` +
            `(last error: ${lastErrorDetail || "unknown"}).`,
        });
        errorKind = null;
        errorSince = 0;
        lastErrorLogAt = 0;
        lastErrorDetail = "";
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const now = Date.now();
      lastErrorDetail = detail;
      if (errorKind === null) {
        errorKind = "unreachable";
        errorSince = now;
        lastErrorLogAt = now;
        publish({
          ts: now,
          source: "system",
          level: "warn",
          message:
            `[docker-log-bridge:${params.container}] cannot reach log-bridge (${detail}). ` +
            `PageMentor's Logs page will not show ${params.container}'s internal logs until this recovers. ` +
            `Container itself may be running fine — check pm-docker-log-bridge on the GPU host.`,
        });
      } else if (now - lastErrorLogAt >= REPEAT_NOTICE_MS) {
        const downForS = Math.round((now - errorSince) / 1000);
        publish({
          ts: now,
          source: "system",
          level: "warn",
          message:
            `[docker-log-bridge:${params.container}] still down for ${downForS}s (latest: ${detail}).`,
        });
        lastErrorLogAt = now;
      }
    }
    schedule();
  }
  function schedule(delay: number = params.intervalMs) {
    if (stopped) return;
    setTimeout(tick, delay);
  }
  schedule(2000);
  return () => {
    stopped = true;
  };
}

/** Wires up pumps for every container listed in
 *  `PM_DOCKER_LOG_BRIDGE_CONTAINERS` (comma-separated). When the
 *  bridge URL isn't configured, this is a no-op — no pumps started,
 *  no log noise. */
/** Maps a source string (which is just a container name here) to the
 *  fixed LogSource enum the logBus accepts. Falls back to "system"
 *  for containers we haven't given a dedicated colour to yet. */
function mapContainerToSource(s: string): LogSource {
  if (s === "docling" || s === "pm-app" || s === "qwen-tts" ||
      s === "arbiter" || s === "ollama") return s;
  return "system";
}

export function startDockerLogPumps(intervalMs: number = 5000): () => void {
  const baseUrl = process.env.PM_DOCKER_LOG_BRIDGE_URL ?? "";
  const token = process.env.PM_DOCKER_LOG_BRIDGE_TOKEN ?? "";
  const containersRaw =
    process.env.PM_DOCKER_LOG_BRIDGE_CONTAINERS ?? "pm-docling";
  if (!baseUrl.trim()) return () => undefined;
  const containers = containersRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (containers.length === 0) return () => undefined;

  const stops: Array<() => void> = [];
  for (const container of containers) {
    const stop = startDockerContainerPump({
      bridgeBaseUrl: baseUrl,
      bridgeToken: token || undefined,
      container,
      // Re-use existing source enum where applicable so the Logs UI
      // colour-codes nicely. Unknown containers fall under "system".
      source:
        container === "pm-docling"
          ? "docling"
          : container,
      intervalMs,
    });
    stops.push(stop);
  }
  return () => {
    for (const s of stops) s();
  };
}
