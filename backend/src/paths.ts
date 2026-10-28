// Zentrale Pfade
// Windows: Dokumente\PageMentor, sonst ./data; PM_DATA_DIR überschreibt
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join } from "path";

export const IS_WINDOWS = process.platform === "win32";

// Als Exe gebaut? Dann liegt bun nicht als Programm vor
export const IS_COMPILED = !/[\\/]bun(\.exe)?$/i.test(process.execPath);

// Ordner der Exe, sonst Backend-Ordner
export const APP_DIR = IS_COMPILED ? dirname(process.execPath) : join(import.meta.dir, "..");

// Dokumente-Ordner über die Windows-API, beachtet OneDrive und verschobene Bibliotheken
function windowsDocuments(): string {
  try {
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('MyDocuments')"],
      { encoding: "utf8", timeout: 10_000, windowsHide: true }
    );
    const dir = r.stdout?.trim();
    if (dir && existsSync(dir)) return dir;
  } catch {
    // Fallback unten
  }
  return join(homedir(), "Documents");
}

function defaultDataDir(): string {
  if (IS_WINDOWS) return join(windowsDocuments(), "PageMentor");
  return "./data";
}

export const DATA_DIR = process.env.PM_DATA_DIR || defaultDataDir();
export const LOG_DIR = process.env.PM_LOG_DIR || join(DATA_DIR, "logs");
export const AUDIOBOOK_EXPORT_DIR = process.env.PM_AUDIOBOOK_DIR || join(DATA_DIR, "Hörbücher");
// Einwurf für neue PDFs: wird automatisch eingelesen, Erledigtes wandert nach Import/Erledigt
export const IMPORT_DIR = process.env.PM_IMPORT_DIR || join(DATA_DIR, "Import");
export const IMPORT_DONE_DIR = join(IMPORT_DIR, "Erledigt");
// Lesbare Wissensdatenbank: je Dokument Markdown mit Formeln und die Bilder als Dateien
export const KNOWLEDGE_DIR = process.env.PM_KNOWLEDGE_DIR || join(DATA_DIR, "Wissensdatenbank");
export const PUBLIC_DIR = process.env.PM_PUBLIC_DIR || join(APP_DIR, "public");
export const BIN_DIR = process.env.PM_BIN_DIR || join(APP_DIR, "bin");

// Unterordner, an denen alte absolute Pfade neu aufgesetzt werden
const DATA_SUBDIRS = ["voice-samples", "voice-designs", "uploads", "audio", "covers"];

// Absoluten Pfad unter DATA_DIR relativ speichern
export function toDataRel(abs: string): string {
  const norm = abs.replace(/\\/g, "/");
  const base = DATA_DIR.replace(/\\/g, "/").replace(/\/+$/, "");
  if (norm.startsWith(base + "/")) return norm.slice(base.length + 1);
  return abs;
}

// Gespeicherten Pfad auflösen, auch alte absolute Pfade vom NAS
export function fromDataPath(stored: string): string {
  if (!isAbsolute(stored) && !/^[a-zA-Z]:[\\/]/.test(stored)) return join(DATA_DIR, stored);
  if (existsSync(stored)) return stored;
  const norm = stored.replace(/\\/g, "/");
  for (const dir of DATA_SUBDIRS) {
    const idx = norm.lastIndexOf(`/${dir}/`);
    if (idx >= 0) return join(DATA_DIR, norm.slice(idx + 1));
  }
  return stored;
}
