// Ausgehende HTTP-Aufrufe loggen: Ziel, Dauer, Status
import { emitLog } from "./logger";
import { redact } from "./redact";

// Häufige Abfragen ohne Log, Fehler melden die Aufrufer selbst
const QUIET = [
  /\/diagnostics\/recent-logs/,
  /\/logs\/[^/]+\?since=/,
  /\/v1\/status\/poll\//,
  /\/api\/tags$/,
  /\/api\/ps$/,
  /\/status$/,
  /\/health$/,
];

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

// Query-Strings können Tokens tragen: nur Pfad loggen
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return redact(`${u.protocol}//${u.host}${u.pathname}`);
  } catch {
    return redact(url.split("?")[0]);
  }
}

let installed = false;

export function installFetchTap(): void {
  if (installed) return;
  installed = true;
  const orig = globalThis.fetch;
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    if (!/^https?:/i.test(url) || QUIET.some((re) => re.test(url.split("?")[0]) || re.test(url))) {
      return orig(input, init);
    }
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const target = shortUrl(url);
    const t0 = performance.now();
    try {
      const res = await orig(input, init);
      const durationMs = Math.round(performance.now() - t0);
      emitLog(res.ok ? "debug" : "warn", "http-out", `${method} ${target} → ${res.status} (${durationMs} ms)`, {
        ctx: { status: res.status, durationMs },
      });
      return res;
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      const aborted = err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message));
      emitLog(aborted ? "info" : "warn", "http-out", `${method} ${target} ${aborted ? "abgebrochen" : "fehlgeschlagen"} nach ${durationMs} ms`, {
        err,
        ctx: { durationMs },
      });
      throw err;
    }
  };
  globalThis.fetch = Object.assign(wrapped, orig) as typeof fetch;
}
