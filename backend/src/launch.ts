// Start als Desktop-App: eigenes Fenster, nur eine Instanz, sauber beenden
import { spawn } from "child_process";
import { IS_COMPILED, IS_WINDOWS } from "./paths";
import { emitLog } from "./log/logger";
import type { WindowEvent, WindowStart } from "./desktop/window";

// PM_UI: window (eigenes Fenster), browser, none. Standard: Fenster in der Exe
type UiMode = "window" | "browser" | "none";
const UI_MODE: UiMode =
  (process.env.PM_UI as UiMode) || (IS_COMPILED ? (IS_WINDOWS ? "window" : "browser") : "none");

let windowHandle: number | null = null;

export function appWindowHandle(): number | null {
  return windowHandle;
}

async function runningInstance(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Läuft schon eine Instanz? Dann deren Fenster nach vorne holen
export async function alreadyRunning(url: string): Promise<boolean> {
  if (!(await runningInstance(url))) return false;
  if (UI_MODE === "none") return true;
  try {
    const res = await fetch(`${url}/api/app/window`, { signal: AbortSignal.timeout(1500) });
    const { hwnd } = (await res.json()) as { hwnd: number | null };
    if (IS_WINDOWS && hwnd) {
      const { focusWindow } = await import("./desktop/win32");
      if (focusWindow(hwnd)) return true;
    }
  } catch {
    // ältere Instanz ohne Fenster
  }
  openBrowser(url);
  return true;
}

function openBrowser(url: string, appMode = false): void {
  try {
    if (IS_WINDOWS && appMode) {
      // Edge im App-Modus: Fenster ohne Adressleiste
      spawn("cmd.exe", ["/c", "start", "", "msedge", `--app=${url}`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else if (IS_WINDOWS) {
      spawn("explorer.exe", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
    emitLog("info", "startup", `${appMode ? "Edge-App-Fenster" : "Browser"} geöffnet: ${url}`);
  } catch (err) {
    emitLog("warn", "startup", "Browser konnte nicht geöffnet werden", { err });
  }
}

// Eigenes Fenster; schließt der Nutzer es, endet die App
function openWindow(url: string): void {
  const test = process.env.PM_WINDOW_TEST === "1";
  const worker = new Worker(IS_COMPILED ? "./desktop/window.ts" : new URL("./desktop/window.ts", import.meta.url).href);
  let failed = false;
  const fallback = (why: string) => {
    if (failed) return;
    failed = true;
    windowHandle = null;
    emitLog("error", "startup", `App-Fenster nicht verfügbar, nutze Edge: ${why}`);
    if (!test) openBrowser(url, true);
  };
  worker.onmessage = (e: MessageEvent<WindowEvent>) => {
    const ev = e.data;
    if (ev.type === "open") {
      windowHandle = ev.hwnd;
      emitLog("info", "startup", "App-Fenster geöffnet");
    } else if (ev.type === "frameless") {
      if (ev.ok) emitLog("info", "startup", "App-Fenster rahmenlos");
      else emitLog("warn", "startup", `App-Fenster mit Windows-Rahmen: ${ev.error}`);
    } else if (ev.type === "ready") {
      emitLog("info", "startup", "App-Fenster bereit");
    } else if (ev.type === "closed") {
      windowHandle = null;
      quitApp("Fenster geschlossen");
    } else if (ev.type === "error") {
      fallback(ev.message);
    }
  };
  worker.onerror = (e) => fallback(e.message);
  worker.postMessage({ url, exePath: process.execPath, test } satisfies WindowStart);
}

export function openUi(url: string): void {
  if (UI_MODE === "none") return;
  if (UI_MODE === "browser" || !IS_WINDOWS) return openBrowser(url);
  try {
    openWindow(url);
  } catch (err) {
    emitLog("error", "startup", "App-Fenster konnte nicht starten", { err });
    openBrowser(url, true);
  }
}

// Kurz verzögert, damit die Antwort noch rausgeht
export function quitApp(reason: string): void {
  emitLog("info", "startup", `Beende PageMentor: ${reason}`);
  setTimeout(() => process.exit(0), 300);
}
