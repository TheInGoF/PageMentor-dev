// Windows-Firewall: eingehende Regel für den Port der App, damit andere Geräte im Heimnetz durchkommen.
// Anlegen braucht Administratorrechte; Windows fragt dafür einmal nach (UAC)
import { spawn } from "node:child_process";
import { IS_WINDOWS } from "../paths";

const RULE = "PageMentor";

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(cmd, args, { windowsHide: true });
    child.stdout.on("data", (b) => (out += b.toString()));
    child.stderr.on("data", (b) => (out += b.toString()));
    child.on("error", (err) => resolve({ code: -1, out: err.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

// true/false auf Windows, null anderswo
export async function firewallRulePresent(): Promise<boolean | null> {
  if (!IS_WINDOWS) return null;
  const r = await run("netsh", ["advfirewall", "firewall", "show", "rule", `name=${RULE}`]);
  return r.code === 0 && r.out.includes(RULE);
}

export async function allowFirewall(port: number): Promise<{ ok: boolean; error?: string }> {
  if (!IS_WINDOWS) return { ok: false, error: "nur unter Windows" };
  const args = ["advfirewall", "firewall", "add", "rule", `name=${RULE}`, "dir=in", "action=allow", "protocol=TCP", `localport=${port}`, "profile=private,domain"];
  // Mit erhöhten Rechten über PowerShell; bricht der Nutzer die Abfrage ab, endet PowerShell mit Fehler
  const list = args.map((a) => `'${a}'`).join(",");
  const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process -FilePath netsh -ArgumentList ${list} -Verb RunAs -Wait -WindowStyle Hidden`]);
  if (r.code !== 0) return { ok: false, error: r.out.trim().split("\n")[0] || `Exit ${r.code}` };
  const present = await firewallRulePresent();
  return present ? { ok: true } : { ok: false, error: "Regel wurde nicht angelegt" };
}
