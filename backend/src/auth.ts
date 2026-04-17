import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { tt } from "./lib/i18n";

const PASSWORD = process.env.PM_PASSWORD || "changeme";
const COOKIE_NAME = "pm_sid";
const TOKEN = Buffer.from(PASSWORD).toString("base64url");

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ password: string }>();
  if (body.password !== PASSWORD) {
    return c.json({ error: tt(c, "err.wrongPassword") }, 401);
  }
  setCookie(c, COOKIE_NAME, TOKEN, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return c.json({ status: "ok" });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ status: "ok" });
});

authRoutes.get("/check", (c) => {
  const cookie = getCookie(c, COOKIE_NAME);
  if (cookie === TOKEN) return c.json({ authenticated: true });
  return c.json({ authenticated: false }, 401);
});

export async function authMiddleware(c: Context, next: Next) {
  // Skip auth for non-api routes
  if (!c.req.path.startsWith("/api/")) return next();
  // Skip login + health
  if (c.req.path === "/api/auth/login" || c.req.path === "/api/health") return next();

  const cookie = getCookie(c, COOKIE_NAME);
  if (cookie !== TOKEN) {
    return c.json({ error: tt(c, "err.unauthorized") }, 401);
  }
  return next();
}
