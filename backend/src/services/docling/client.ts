// Verbindung zu docling-serve: Status, Health, Requests
import { setTimeout as sleep } from "timers/promises";
import {
  DOCLING_URL,
  DOCLING_API_KEY,
  POLL_INTERVAL_MS,
  type PollResponse,
} from "./types";
import { httpErrorFrom } from "../../log/errors";

// Polling als Fallback, wenn WebSocket nicht geht
export async function pollUntilDone(
  taskId: string,
  signal: AbortSignal | undefined,
  report: (s: PollResponse) => string
): Promise<void> {
  while (true) {
    if (signal?.aborted) throw new Error("canceled");
    try {
      await sleep(POLL_INTERVAL_MS, undefined, { signal });
    } catch {
      throw new Error("canceled");
    }
    const res = await doclingFetch(`/v1/status/poll/${taskId}`);
    if (!res.ok) throw await httpErrorFrom(res, "Docling-Status");
    const status = (await res.json()) as PollResponse;
    const state = report(status);
    if (state === "success") return;
    if (state === "failure" || state === "error") {
      throw new Error(`docling task ${taskId} failed: ${JSON.stringify(status)}`);
    }
  }
}

// Status per WebSocket: ohne 4-s-Verzögerung, ohne Log-Flut
// Bei Fehler fällt der Aufrufer auf Polling zurück
export async function subscribeViaWs(
  taskId: string,
  signal: AbortSignal | undefined,
  report: (s: PollResponse) => string
): Promise<void> {
  const wsBase = DOCLING_URL.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
  const authQuery = DOCLING_API_KEY ? `?api_key=${encodeURIComponent(DOCLING_API_KEY)}` : "";
  const url = `${wsBase}/v1/status/ws/${taskId}${authQuery}`;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err);
      return;
    }

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* best effort */
      }
      fn();
    };

    // Verbindung muss in 5 s stehen
    const connectTimeout = setTimeout(() => {
      finish(() => reject(new Error("WS connect timeout")));
    }, 5000);

    ws.addEventListener("open", () => {
      clearTimeout(connectTimeout);
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      let payload: { message?: string; task?: PollResponse; error?: string };
      try {
        payload = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (payload.message === "error") {
        finish(() =>
          reject(new Error(`docling WS error: ${payload.error ?? "(no detail)"}`))
        );
        return;
      }
      const task = payload.task;
      if (!task) return;
      const state = report(task);
      if (state === "success") {
        finish(() => resolve());
      } else if (state === "failure" || state === "error") {
        finish(() =>
          reject(new Error(`docling task ${taskId} failed: ${JSON.stringify(task)}`))
        );
      }
    });

    ws.addEventListener("error", (ev: Event) => {
      clearTimeout(connectTimeout);
      finish(() =>
        reject(new Error(`WS error: ${(ev as unknown as { message?: string }).message ?? "unknown"}`))
      );
    });

    ws.addEventListener("close", () => {
      clearTimeout(connectTimeout);
      // Ende ohne success: als Fehler melden, dann Polling
      finish(() => reject(new Error("WS closed before task completion")));
    });

    signal?.addEventListener("abort", () => {
      finish(() => reject(new Error("canceled")));
    });
  });
}

export function numOr(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export async function doclingFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (DOCLING_API_KEY) headers.set("X-Api-Key", DOCLING_API_KEY);
  return fetch(`${DOCLING_URL}${path}`, { ...init, headers });
}

// Health-Check zu Beginn der Pipeline
export async function doclingAlive(): Promise<boolean> {
  try {
    const res = await doclingFetch("/health", { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}
