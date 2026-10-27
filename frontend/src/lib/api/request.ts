// Fetch-Hülle mit Fehlerbehandlung

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // UI-Sprache mitschicken: Fehlermeldungen passend
  let acceptLang = "en";
  try {
    const { currentLocale } = await import("../i18n");
    acceptLang = currentLocale();
  } catch {
    // i18n kann beim Start noch fehlen
  }
  const res = await fetch(path, {
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
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
