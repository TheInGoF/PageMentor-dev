// Start als Desktop-App: nur eine Instanz, Browser öffnen, sauber beenden
import { spawn } from "child_process";
import { IS_COMPILED, IS_WINDOWS } from "./paths";
import { emitLog } from "./log/logger";

// Läuft schon eine Instanz? Dann nur den Browser öffnen
export async function alreadyRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export function openBrowser(url: string): void {
  // Nur für die installierte App; PM_OPEN_BROWSER=0 schaltet ab
  if (process.env.PM_OPEN_BROWSER === "0") return;
  if (!IS_COMPILED && process.env.PM_OPEN_BROWSER !== "1") return;
  try {
    if (IS_WINDOWS) spawn("explorer.exe", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    emitLog("info", "startup", `Browser geöffnet: ${url}`);
  } catch (err) {
    emitLog("warn", "startup", "Browser konnte nicht geöffnet werden", { err });
  }
}

// Kurz verzögert, damit die Antwort noch rausgeht
export function quitApp(reason: string): void {
  emitLog("info", "startup", `Beende PageMentor: ${reason}`);
  setTimeout(() => process.exit(0), 300);
}
