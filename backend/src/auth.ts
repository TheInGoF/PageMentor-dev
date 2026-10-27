// Nur lokaler Zugriff, kein Login
// Host- und Origin-Prüfung gegen fremde Webseiten (CSRF, DNS-Rebinding)
// PM_ALLOW_REMOTE=1 schaltet die Prüfung ab, z. B. für Docker
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { emitLog } from "./log/logger";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ALLOW_REMOTE = process.env.PM_ALLOW_REMOTE === "1";

function hostnameOf(hostHeader: string): string {
  // "[::1]:3100" oder "localhost:3100"
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0].toLowerCase();
}

function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return LOCAL_HOSTS.has(u.hostname.toLowerCase()) || LOCAL_HOSTS.has(`[${u.hostname}]`);
  } catch {
    return false;
  }
}

export async function localOnly(c: Context, next: Next) {
  if (ALLOW_REMOTE) return next();
  const host = hostnameOf(c.req.header("host") ?? "");
  const origin = c.req.header("origin");
  if (!LOCAL_HOSTS.has(host) || (origin && origin !== "null" && !isLocalOrigin(origin))) {
    emitLog("warn", "security", `Anfrage abgewiesen: Host=${host} Origin=${origin ?? "-"} ${c.req.method} ${c.req.path}`);
    return c.json({ error: "Nur lokaler Zugriff erlaubt" }, 403);
  }
  return next();
}

// Alte Clients fragen noch /check ab
export const authRoutes = new Hono();
authRoutes.get("/check", (c) => c.json({ authenticated: true }));
