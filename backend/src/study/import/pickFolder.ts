// Ordnerauswahl über den Windows-Dialog; anderswo gibt es nur das Eingabefeld
import { spawnSync } from "child_process";
import { IS_WINDOWS } from "../../paths";

const SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$d.Description = 'Studium-Maker-Ordner wählen'",
  "$d.ShowNewFolderButton = $false",
  "$f = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}",
  "if ($d.ShowDialog($f) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.SelectedPath }",
].join("; ");

export function pickFolder(): string | null {
  if (!IS_WINDOWS) return null;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-STA", "-Command", SCRIPT], { encoding: "utf8", timeout: 300_000, windowsHide: true });
  const path = r.stdout?.trim();
  return path || null;
}
