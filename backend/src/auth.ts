// Zugriffsschutz: am PC (localhost) ohne Anmeldung; aus dem Heimnetz nur, wenn eingeschaltet, und dann mit
// Passwort und Sitzungskeks. Host- und Origin-Prüfung gegen fremde Webseiten (CSRF, DNS-Rebinding).
// PM_ALLOW_REMOTE=1 schaltet alles ab, z. B. für Docker
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { emitLog } from "./log/logger";
import { allowFirewall, firewallRulePresent } from "./desktop/firewall";
import {
  createSession, hasLanPassword, lanAddresses, lanEnabled, loginAllowed, noteLogin, revokeAllSessions, revokeSession,
  setLanEnabled, setLanPassword, validSession, verifyLanPassword,
} from "./lan";
import { LAN_HOST, LOCAL_HOST, rebindServer, serverHost } from "./server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ALLOW_REMOTE = process.env.PM_ALLOW_REMOTE === "1";
const COOKIE = "pm_session";
// Ohne Anmeldung erreichbar: Oberfläche selbst, Gesundheit und die Anmeldung
const OPEN = [/^\/api\/health$/, /^\/api\/auth\/(check|login)$/];

function hostnameOf(hostHeader: string): string {
  // "[::1]:3100" oder "localhost:3100"
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0].toLowerCase();
}

function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

// Origin passt zum angefragten Host (lokal zu lokal, sonst gleicher Host)
function originMatches(origin: string, host: string): boolean {
  try {
    const u = new URL(origin);
    const o = u.hostname.toLowerCase();
    if (isLocalHost(host)) return LOCAL_HOSTS.has(o) || LOCAL_HOSTS.has(`[${o}]`);
    return o === host || `[${o}]` === host;
  } catch {
    return false;
  }
}

export function isLocalRequest(c: Context): boolean {
  return ALLOW_REMOTE || isLocalHost(hostnameOf(c.req.header("host") ?? ""));
}

function reject(c: Context, why: string, status: 401 | 403) {
  emitLog("warn", "security", `Anfrage abgewiesen (${why}): Host=${c.req.header("host") ?? "-"} Origin=${c.req.header("origin") ?? "-"} ${c.req.method} ${c.req.path}`);
  return c.json({ error: status === 401 ? "Anmeldung nötig" : "Nur lokaler Zugriff erlaubt", login: status === 401 }, status);
}

export async function accessGuard(c: Context, next: Next) {
  if (ALLOW_REMOTE) return next();
  const host = hostnameOf(c.req.header("host") ?? "");
  const origin = c.req.header("origin");
  if (origin && origin !== "null" && !originMatches(origin, host)) return reject(c, "Origin", 403);
  if (isLocalHost(host)) return next();
  if (!lanEnabled()) return reject(c, "Host", 403);
  // Heimnetz: Oberfläche frei, API nur mit Sitzung
  if (!c.req.path.startsWith("/api/") || OPEN.some((re) => re.test(c.req.path))) return next();
  if (validSession(getCookie(c, COOKIE))) return next();
  return reject(c, "ohne Anmeldung", 401);
}

export const authRoutes = new Hono();

authRoutes.get("/check", (c) => {
  const local = isLocalRequest(c);
  return c.json({ authenticated: local || validSession(getCookie(c, COOKIE)), local, lan: lanEnabled() });
});

authRoutes.post("/login", async (c) => {
  if (!loginAllowed()) return c.json({ error: "Zu viele Versuche, bitte kurz warten", locked: true }, 429);
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: "" }));
  const ok = lanEnabled() && verifyLanPassword(password ?? "");
  noteLogin(ok);
  if (!ok) return c.json({ error: "Passwort falsch" }, 401);
  setCookie(c, COOKIE, createSession(), { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 90 * 86_400 });
  emitLog("info", "security", `Anmeldung aus dem Heimnetz: ${c.req.header("host") ?? "-"}`);
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  revokeSession(getCookie(c, COOKIE));
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// Einstellungen fürs Heimnetz: nur am PC selbst änderbar
const port = () => Number(process.env.PM_PORT_INTERNAL || process.env.PORT || 3100);
const fixedHost = () => !!process.env.PM_HOST;

async function lanInfo() {
  return {
    enabled: lanEnabled(),
    passwordSet: hasLanPassword(),
    port: port(),
    addresses: lanAddresses(port()),
    host: serverHost(),
    fixedHost: fixedHost(),
    firewall: await firewallRulePresent(),
  };
}

authRoutes.get("/lan", async (c) => {
  if (!isLocalRequest(c)) return c.json({ error: "Nur am PC änderbar" }, 403);
  return c.json(await lanInfo());
});

authRoutes.put("/lan", async (c) => {
  if (!isLocalRequest(c)) return c.json({ error: "Nur am PC änderbar" }, 403);
  const body = await c.req.json<{ enabled?: boolean; password?: string }>();
  if (body.password?.trim()) {
    setLanPassword(body.password.trim());
    // Neues Passwort: alle Geräte melden sich neu an
    revokeAllSessions();
  }
  if (body.enabled !== undefined) {
    if (body.enabled && !hasLanPassword()) return c.json({ error: "Erst ein Passwort setzen" }, 400);
    setLanEnabled(body.enabled);
    emitLog("info", "security", `Zugriff aus dem Heimnetz ${body.enabled ? "eingeschaltet" : "ausgeschaltet"}`);
    // Nach der Antwort neu binden; das Fenster am PC verbindet sich von selbst neu
    if (!fixedHost()) setTimeout(() => void rebindServer(body.enabled ? LAN_HOST : LOCAL_HOST).catch(() => {}), 300);
  }
  return c.json(await lanInfo());
});

authRoutes.post("/lan/firewall", async (c) => {
  if (!isLocalRequest(c)) return c.json({ error: "Nur am PC änderbar" }, 403);
  const r = await allowFirewall(port());
  return c.json({ ...r, firewall: await firewallRulePresent() });
});
