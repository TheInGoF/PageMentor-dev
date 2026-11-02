import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Hono } from "hono";

const TMP = mkdtempSync(join(tmpdir(), "pm-lan-"));
type Mods = { lan: typeof import("./lan"); auth: typeof import("./auth") };
let x: Mods;
let app: Hono;

const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers: { host: "127.0.0.1:3100", ...headers } });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", body: JSON.stringify(body), headers: { host: "127.0.0.1:3100", "content-type": "application/json", ...headers } });
const put = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "PUT", body: JSON.stringify(body), headers: { host: "127.0.0.1:3100", "content-type": "application/json", ...headers } });
const LAN = { host: "192.168.1.20:3100" };

beforeAll(async () => {
  x = { lan: await import("./lan"), auth: await import("./auth") };
  x.lan.useLanFile(join(TMP, "lan.json"));
  app = new Hono();
  app.use("/*", x.auth.accessGuard);
  app.route("/api/auth", x.auth.authRoutes);
  app.get("/api/documents", (c) => c.json({ ok: true }));
  app.get("/index.html", (c) => c.text("<html>"));
});

describe("Heimnetz-Zugriff", () => {
  test("Passwort als Hash, Prüfung, Sitzungen", () => {
    expect(x.lan.hasLanPassword()).toBe(false);
    x.lan.setLanPassword("geheim");
    expect(x.lan.hasLanPassword()).toBe(true);
    expect(x.lan.verifyLanPassword("geheim")).toBe(true);
    expect(x.lan.verifyLanPassword("falsch")).toBe(false);
    const t = x.lan.createSession();
    expect(x.lan.validSession(t)).toBe(true);
    expect(x.lan.validSession("x")).toBe(false);
    x.lan.revokeSession(t);
    expect(x.lan.validSession(t)).toBe(false);
    expect(x.lan.lanAddresses(3100)[0]).toMatch(/^http:\/\/.+:3100$/);
  });

  test("Anmeldeversuche: nach fünf Fehlschlägen eine Pause", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) x.lan.noteLogin(false, t0);
    expect(x.lan.loginAllowed(t0)).toBe(true);
    x.lan.noteLogin(false, t0);
    expect(x.lan.loginAllowed(t0 + 1000)).toBe(false);
    expect(x.lan.loginAllowed(t0 + 31_000)).toBe(true);
    x.lan.noteLogin(true);
  });

  test("ausgeschaltet: lokal frei, fremder Host abgewiesen", async () => {
    x.lan.setLanEnabled(false);
    expect((await get("/api/documents")).status).toBe(200);
    expect((await get("/api/documents", LAN)).status).toBe(403);
    expect((await get("/api/documents", { origin: "https://evil.example" })).status).toBe(403);
  });

  test("eingeschaltet: Oberfläche frei, API erst nach Anmeldung mit Keks", async () => {
    x.lan.setLanEnabled(true);
    expect((await get("/index.html", LAN)).status).toBe(200);
    const denied = await get("/api/documents", LAN);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ login: true });
    expect((await get("/api/auth/check", LAN)).json()).resolves.toMatchObject({ authenticated: false, local: false, lan: true });

    expect((await post("/api/auth/login", { password: "falsch" }, LAN)).status).toBe(401);
    const login = await post("/api/auth/login", { password: "geheim" }, LAN);
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pm_session=");
    expect(cookie).toContain("HttpOnly");
    const session = cookie.split(";")[0];
    expect((await get("/api/documents", { ...LAN, cookie: session })).status).toBe(200);
    // Origin muss zum Host passen, auch mit Keks
    expect((await get("/api/documents", { ...LAN, cookie: session, origin: "http://192.168.1.99:3100" })).status).toBe(403);
    expect((await get("/api/documents", { ...LAN, cookie: session, origin: "http://192.168.1.20:3100" })).status).toBe(200);
    // Einstellungen fürs Heimnetz nur vom PC
    expect((await get("/api/auth/lan", { ...LAN, cookie: session })).status).toBe(403);
    expect((await get("/api/auth/lan")).json()).resolves.toMatchObject({ enabled: true, passwordSet: true, port: 3100 });
    // Abmelden macht den Keks ungültig
    expect((await post("/api/auth/logout", {}, { ...LAN, cookie: session })).status).toBe(200);
    expect((await get("/api/documents", { ...LAN, cookie: session })).status).toBe(401);
  });

  test("Einschalten braucht ein Passwort; neues Passwort wirft alle Geräte raus", async () => {
    const t = x.lan.createSession();
    expect((await put("/api/auth/lan", { password: "neu" })).status).toBe(200);
    expect(x.lan.validSession(t)).toBe(false);
    expect(x.lan.verifyLanPassword("neu")).toBe(true);
    x.lan.useLanFile(join(TMP, "leer.json"));
    expect((await put("/api/auth/lan", { enabled: true })).status).toBe(400);
  });
});
