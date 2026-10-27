// Frontend-Fehler ans Backend melden, landen im selben Log
interface ClientError {
  kind: string;
  message: string;
  level?: "warn" | "error";
  stack?: string;
  componentStack?: string;
  status?: number;
  path?: string;
}

const recent = new Map<string, number>();
const DEDUPE_MS = 10_000;

export function reportClientError(e: ClientError): void {
  const key = `${e.kind}|${e.message}|${e.path ?? ""}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - DEDUPE_MS) return;
  recent.set(key, now);
  try {
    void fetch("/api/logs/client", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...e, url: location.pathname + location.search }),
    }).catch(() => {});
  } catch {
    // Melden darf nie selbst scheitern
  }
}

function asError(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  return { message: typeof value === "string" ? value : JSON.stringify(value) };
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (ev) => {
    const err = asError(ev.error ?? ev.message);
    reportClientError({ kind: "window.onerror", ...err, path: `${ev.filename}:${ev.lineno}:${ev.colno}` });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    reportClientError({ kind: "unhandledrejection", ...asError(ev.reason) });
  });
}
