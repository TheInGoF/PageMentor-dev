// Zugriff aus dem Heimnetz: Schalter, Passwort (nur als Hash) und Anmeldesitzungen anderer Geräte.
// Liegt in lan.json im Datenordner; das Fenster am PC selbst braucht keine Anmeldung
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { DATA_DIR } from "./paths";

type LanFile = { enabled?: boolean; password?: string; sessions?: Record<string, number> };

const SESSION_DAYS = 90;
const MAX_FAILS = 5;
const LOCK_MS = 30_000;

let file = join(DATA_DIR, "lan.json");
let cache: LanFile | null = null;

// Für Tests: eigene Datei
export function useLanFile(path: string): void {
  file = path;
  cache = null;
}

function load(): LanFile {
  if (cache) return cache;
  try {
    cache = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as LanFile) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save(patch: Partial<LanFile>): void {
  cache = { ...load(), ...patch };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cache, null, 2));
}

export function lanEnabled(): boolean {
  return load().enabled === true;
}

export function hasLanPassword(): boolean {
  return !!load().password;
}

export function setLanEnabled(on: boolean): void {
  save({ enabled: on });
}

// scrypt mit eigenem Salz; "salz:hash" als Hex
export function setLanPassword(password: string): void {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  save({ password: `${salt}:${hash}` });
}

export function verifyLanPassword(password: string): boolean {
  const stored = load().password;
  if (!stored || !password) return false;
  const [salt, hash] = stored.split(":");
  const probe = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return probe.length === expected.length && timingSafeEqual(probe, expected);
}

// Sitzungen: zufälliges Kennzeichen, abgelaufene fallen beim nächsten Schreiben weg
function liveSessions(): Record<string, number> {
  const cutoff = Date.now() - SESSION_DAYS * 86_400_000;
  return Object.fromEntries(Object.entries(load().sessions ?? {}).filter(([, at]) => at > cutoff));
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  save({ sessions: { ...liveSessions(), [token]: Date.now() } });
  return token;
}

export function validSession(token: string | undefined): boolean {
  return !!token && token in liveSessions();
}

export function revokeSession(token: string | undefined): void {
  if (!token) return;
  const sessions = liveSessions();
  delete sessions[token];
  save({ sessions });
}

export function revokeAllSessions(): void {
  save({ sessions: {} });
}

// Anmeldeversuche bremsen: nach fünf Fehlschlägen eine halbe Minute Pause
let fails = 0;
let lockedUntil = 0;

export function loginAllowed(now = Date.now()): boolean {
  return now >= lockedUntil;
}

export function noteLogin(ok: boolean, now = Date.now()): void {
  if (ok) {
    fails = 0;
    lockedUntil = 0;
    return;
  }
  fails++;
  if (fails >= MAX_FAILS) {
    fails = 0;
    lockedUntil = now + LOCK_MS;
  }
}

// Adressen, unter denen andere Geräte die App erreichen: Rechnername und jede IPv4-Adresse des Rechners
export function lanAddresses(port: number): string[] {
  const out = [`http://${hostname().toLowerCase()}:${port}`];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) out.push(`http://${i.address}:${port}`);
    }
  }
  return out;
}
