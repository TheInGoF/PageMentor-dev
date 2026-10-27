// Fehler vollständig erfassen: Stack, Ursache, HTTP-Details
import type { ErrorInfo } from "./types";
import { redact } from "./redact";

const MAX_BODY = 2000;

// Fehler einer Gegenstelle mit Status und Antworttext
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public url: string,
    public body: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Antwort lesen und als HttpError werfen, Text gekürzt
export async function httpErrorFrom(res: Response, what: string): Promise<HttpError> {
  const body = await res.text().catch(() => "");
  return new HttpError(
    `${what}: HTTP ${res.status} ${res.statusText}`,
    res.status,
    res.url,
    body.slice(0, MAX_BODY)
  );
}

export function describeError(err: unknown, depth = 0): ErrorInfo {
  if (err instanceof Error) {
    const e = err as Error & {
      status?: unknown;
      statusCode?: unknown;
      url?: unknown;
      body?: unknown;
      code?: unknown;
    };
    const info: ErrorInfo = {
      name: e.name || "Error",
      message: redact(e.message || String(e)),
    };
    if (e.stack) info.stack = redact(e.stack);
    const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : undefined;
    if (status !== undefined) info.status = status;
    if (typeof e.url === "string") info.url = redact(e.url);
    if (typeof e.body === "string" && e.body) info.body = redact(e.body.slice(0, MAX_BODY));
    if (typeof e.code === "string") info.name = `${info.name} (${e.code})`;
    if (e.cause !== undefined && depth < 5) info.cause = describeError(e.cause, depth + 1);
    return info;
  }
  if (typeof err === "object" && err !== null) {
    let text: string;
    try {
      text = JSON.stringify(err);
    } catch {
      text = String(err);
    }
    return { name: "NonError", message: redact(text.slice(0, MAX_BODY)) };
  }
  return { name: "NonError", message: redact(String(err)) };
}

// Kurzform für die Meldungszeile: "Name: Nachricht ← Ursache"
export function errorSummary(info: ErrorInfo): string {
  let s = `${info.name}: ${info.message}`;
  if (info.status) s += ` [HTTP ${info.status}]`;
  if (info.cause) s += ` ← ${errorSummary(info.cause)}`;
  return s;
}
