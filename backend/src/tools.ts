// Externe Werkzeuge finden: erst mitgeliefertes bin\, dann PATH
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { BIN_DIR, IS_WINDOWS } from "./paths";

export const TOOLS = ["ffmpeg", "ffprobe", "pdftoppm", "tesseract", "AtomicParsley"] as const;
export type ToolName = (typeof TOOLS)[number];

const cache = new Map<string, string | null>();

export function resolveTool(name: string): string | null {
  if (cache.has(name)) return cache.get(name)!;
  const file = IS_WINDOWS ? `${name}.exe` : name;
  // bin\ direkt oder ein Unterordner, z. B. bin\poppler mit DLLs
  const candidates = [join(BIN_DIR, file)];
  for (const sub of subdirs()) candidates.push(join(BIN_DIR, sub, file), join(BIN_DIR, sub, "bin", file));
  const found = candidates.find((p) => existsSync(p)) ?? Bun.which(name) ?? null;
  cache.set(name, found);
  return found;
}

function subdirs(): string[] {
  try {
    return readdirSync(BIN_DIR).filter((d) => statSync(join(BIN_DIR, d)).isDirectory());
  } catch {
    return [];
  }
}

// Pfad für spawn; fehlt das Werkzeug, bleibt der Name für eine klare Fehlermeldung
export function toolPath(name: string): string {
  return resolveTool(name) ?? name;
}

export function toolStatus(): Record<string, string> {
  return Object.fromEntries(TOOLS.map((t) => [t, resolveTool(t) ?? "FEHLT"]));
}
