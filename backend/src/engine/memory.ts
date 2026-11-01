// Arbeitsspeicher der Engine-Umgebung (vmmemWSL): Während des Betriebs gibt WSL ungenutzten Speicher schrittweise
// an Windows zurück (autoMemoryReclaim). Beim Beenden von PageMentor fährt die Umgebung herunter, dann gibt
// WSL den Speicher ganz frei. Abschaltbar mit PM_ENGINE_KEEP_RUNNING=1; eine Engine im LAN bleibt unberührt
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { IS_WINDOWS } from "../paths";
import { DISTRO } from "./config";
import { logEngine } from "./exec";

const WSLCONFIG = () => join(process.env.USERPROFILE || homedir(), ".wslconfig");

// Fehlende Einstellung ergänzen, vorhandene nie überschreiben (der Nutzer darf selbst etwas anderes wollen)
export function withMemoryReclaim(text: string): string {
  if (/^\s*autoMemoryReclaim\s*=/im.test(text)) return text;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((l) => /^\s*\[experimental\]\s*$/i.test(l));
  if (at >= 0) lines.splice(at + 1, 0, "autoMemoryReclaim=gradual");
  else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push("");
    lines.push("[experimental]", "autoMemoryReclaim=gradual");
  }
  return lines.join("\r\n") + "\r\n";
}

export function ensureMemoryReclaim(): void {
  if (!IS_WINDOWS) return;
  try {
    const file = WSLCONFIG();
    const before = existsSync(file) ? readFileSync(file, "utf8") : "";
    const after = withMemoryReclaim(before);
    if (after === before) return;
    writeFileSync(file, after);
    logEngine("info", "WSL gibt ungenutzten Arbeitsspeicher künftig zurück (.wslconfig: autoMemoryReclaim=gradual, gilt ab dem nächsten Start der Umgebung)");
  } catch (err) {
    logEngine("warn", ".wslconfig nicht angepasst", err);
  }
}

// Beim Beenden: Dienste kurz geordnet stoppen, dann die Umgebung beenden. Läuft keine andere WSL-Umgebung,
// fährt WSL kurz danach herunter und vmmemWSL gibt den ganzen Speicher frei
export function releaseEngineOnExit(): void {
  if (!IS_WINDOWS || process.env.PM_ENGINE_KEEP_RUNNING === "1" || process.env.PM_ENGINE_HOST) return;
  try {
    spawnSync("wsl.exe", ["-d", DISTRO, "-u", "root", "--exec", "bash", "-lc", "docker ps -q | xargs -r docker stop -t 5 >/dev/null 2>&1"], {
      windowsHide: true,
      timeout: 25_000,
    });
  } catch {
    // dann eben hart
  }
  spawnSync("wsl.exe", ["--terminate", DISTRO], { windowsHide: true, timeout: 20_000 });
}
