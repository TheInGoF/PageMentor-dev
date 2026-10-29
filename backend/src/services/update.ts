// Update aus der App: neuestes GitHub-Release finden, Setup laden, still installieren, App neu starten
import { spawn } from "child_process";
import { createWriteStream, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { DATA_DIR, IS_COMPILED, IS_WINDOWS } from "../paths";
import { APP_VERSION } from "../version";
import { emitLog } from "../log/logger";

const REPO = process.env.PM_UPDATE_REPO || "TheInGoF/PageMentor-dev";
const CHECK_TTL_MS = 60 * 60_000;

export interface UpdateState {
  current: string;
  latest: string | null;
  newer: boolean;
  // Nur die installierte Windows-App kann sich selbst aktualisieren
  canInstall: boolean;
  releaseUrl: string | null;
  phase: "idle" | "downloading" | "installing" | "error";
  fraction: number | null;
  error: string | null;
}

const state: UpdateState = { current: APP_VERSION, latest: null, newer: false, canInstall: IS_WINDOWS && IS_COMPILED, releaseUrl: null, phase: "idle", fraction: null, error: null };
let checkedAt = 0;

export function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

// releases/latest leitet auf .../tag/v<version> um; ohne API-Schlüssel und ohne Ratenlimit
async function latestVersion(): Promise<string | null> {
  const res = await fetch(`https://github.com/${REPO}/releases/latest`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  const loc = res.headers.get("location") ?? "";
  return /\/tag\/v?(\d+\.\d+\.\d+)$/.exec(loc)?.[1] ?? null;
}

export async function checkUpdate(force = false): Promise<UpdateState> {
  if (!force && Date.now() - checkedAt < CHECK_TTL_MS) return state;
  checkedAt = Date.now();
  try {
    const latest = await latestVersion();
    state.latest = latest;
    state.newer = !!latest && isNewer(latest, APP_VERSION);
    state.releaseUrl = latest ? `https://github.com/${REPO}/releases/tag/v${latest}` : null;
  } catch {
    // Offline: nichts melden, beim nächsten Mal wieder
  }
  return state;
}

export function updateState(): UpdateState {
  return state;
}

// Setup laden und mit /VERYSILENT starten; das Setup beendet die App und startet sie danach neu (/RESTART=1)
export async function installUpdate(onQuit: () => void): Promise<void> {
  if (!state.canInstall) throw new Error("Update aus der App nur in der installierten Windows-App");
  if (!state.latest || !state.newer) throw new Error("Kein neueres Release");
  if (state.phase === "downloading" || state.phase === "installing") return;
  const v = state.latest;
  const dir = join(DATA_DIR, "updates");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `PageMentor-Setup-${v}.exe`);
  state.phase = "downloading";
  state.fraction = 0;
  state.error = null;
  try {
    const res = await fetch(`https://github.com/${REPO}/releases/download/v${v}/PageMentor-Setup-${v}.exe`);
    if (!res.ok || !res.body) throw new Error(`Download HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    const out = createWriteStream(file);
    let done = 0;
    for await (const chunk of res.body) {
      out.write(chunk);
      done += chunk.length;
      if (total) state.fraction = done / total;
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (done < 1_000_000) throw new Error("Setup unvollständig geladen");
    state.phase = "installing";
    emitLog("info", "startup", `Update auf ${v}: Setup startet`);
    spawn(file, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/RESTART=1"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    onQuit();
  } catch (err) {
    state.phase = "error";
    state.error = err instanceof Error ? err.message : String(err);
    emitLog("warn", "startup", "Update fehlgeschlagen", { err });
  }
}
