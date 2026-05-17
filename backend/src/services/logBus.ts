/**
 * In-memory log fan-out.
 *
 * Every `console.log/info/warn/error` call inside the backend is
 * intercepted on startup (see `installLogTap` in index.ts) and
 * pushed through this bus. The Logs page subscribes via SSE and
 * receives the merged stream in real time.
 *
 * Sidecar lines are forwarded into the same bus by the
 * `sidecarLogPump` task so the UI sees backend + sidecar in one
 * timeline without having to SSH onto the GPU host.
 */
export type LogSource =
  | "pm-app"
  | "qwen-tts"
  | "arbiter"
  | "ollama"
  | "docling"
  | "system";
export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogLine {
  ts: number;
  source: LogSource;
  level: LogLevel;
  message: string;
}

type Handler = (l: LogLine) => void;

const RING_SIZE = 2000;
const ring: LogLine[] = [];
const subs = new Set<Handler>();

export function publish(line: LogLine): void {
  ring.push(line);
  if (ring.length > RING_SIZE) ring.shift();
  for (const h of subs) {
    try {
      h(line);
    } catch {
      // a buggy subscriber doesn't get to break the bus
    }
  }
}

export function subscribe(handler: Handler): () => void {
  subs.add(handler);
  return () => {
    subs.delete(handler);
  };
}

/** Snapshot of recent lines for late SSE joiners. */
export function recent(): LogLine[] {
  return ring.slice();
}
