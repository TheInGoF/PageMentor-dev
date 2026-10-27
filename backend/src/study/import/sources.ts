// Studium Maker: Dateien im gewählten Ordner finden und lesen; fehlende Teile werden Warnungen
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface SmEntry {
  id: string;
  title: string;
  month?: string | null;
  type: string;
  status: string;
  date?: string | null;
  note?: string | null;
  attempt?: number | null;
  cp?: number | null;
  grade?: number | string | null;
  modul?: string | null;
  heftcode?: string | null;
}

export interface SmHabit {
  id: string;
  date: string;
  kind: string;
  minutes: number;
  module?: string | null;
  note?: string | null;
}

export type SmMaterial = Record<string, Record<string, Array<{ datei?: string; titel?: string; pfad?: string }>>>;

export interface SmModuleMap {
  module?: Record<string, { name?: string; lehrheft_praefixe?: string[]; beleg?: string | null }>;
  unbestaetigte_praefixe?: { eintraege?: Record<string, string[]> };
}

export interface SmSources {
  folder: string;
  plannerHtml: string | null;
  entries: SmEntry[];
  habits: SmHabit[];
  material: SmMaterial;
  moduleMap: SmModuleMap | null;
  warnings: string[];
}

function readJson<T>(file: string, warnings: string[]): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    warnings.push(`${file}: kein gültiges JSON (${err instanceof Error ? err.message : err})`);
    return null;
  }
}

export function readSources(folder: string): SmSources {
  if (!existsSync(folder)) throw new Error(`Ordner nicht gefunden: ${folder}`);
  const warnings: string[] = [];
  const htmlFile = join(folder, "studienplaner.html");
  const plannerHtml = existsSync(htmlFile) ? readFileSync(htmlFile, "utf8") : null;
  if (!plannerHtml) warnings.push("studienplaner.html fehlt: keine Module, Termine und Trainer");

  const studium = readJson<{ entries?: SmEntry[]; habits?: SmHabit[] }>(join(folder, "30_data", "studium.json"), warnings);
  if (!studium) warnings.push("30_data/studium.json fehlt: keine Leistungen und Lernzeit");
  const material = readJson<SmMaterial>(join(folder, "30_data", "material.json"), warnings) ?? {};

  const moduleMap = readJson<SmModuleMap>(join(folder, "scripts", "module_map.json"), warnings);
  return {
    folder,
    moduleMap,
    plannerHtml,
    entries: Array.isArray(studium?.entries) ? studium.entries : [],
    habits: Array.isArray(studium?.habits) ? studium.habits : [],
    material,
    warnings,
  };
}
