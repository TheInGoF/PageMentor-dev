// Fetch-Hülle mit Fehlerbehandlung
import { reportClientError } from "../reportError";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const EXPECTED_404 = [/\/api\/audio\/progress\//];

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // UI-Sprache mitschicken: Fehlermeldungen passend
  let acceptLang = "en";
  try {
    const { currentLocale } = await import("../i18n");
    acceptLang = currentLocale();
  } catch {
    // i18n kann beim Start noch fehlen
  }
  const method = init?.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "include",
      ...init,
      headers: {
        "Accept-Language": acceptLang,
        ...(init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init?.headers || {}),
      },
    });
  } catch (err) {
    reportClientError({ kind: "api-netzwerk", message: err instanceof Error ? err.message : String(err), path: `${method} ${path}` });
    throw err;
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {
      // ignore
    }
    // 401 = nicht angemeldet; erwartete 404 ohne laufenden Job
    if (res.status !== 401 && !EXPECTED_404.some((re) => res.status === 404 && re.test(path))) {
      reportClientError({ kind: "api", level: res.status >= 500 ? "error" : "warn", message: msg, status: res.status, path: `${method} ${path}` });
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
