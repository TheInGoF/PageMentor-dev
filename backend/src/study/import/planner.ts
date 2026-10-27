// Studium Maker: Modulkatalog, Prüfungstermine und Trainer aus studienplaner.html lesen
import { extractConst } from "../../lib/jsLiteral";

export interface CatalogModule {
  name: string;
  examForm: string;
  cp: number;
  studySemester: number | null;
  code: string | null;
  area: string;
}

export interface TrainerRef {
  code: string;
  file: string;
  globalName: string;
  colorsName: string | null;
  title: string;
}

export interface PlannerInfo {
  modules: CatalogModule[];
  examDates: string[];
  trainers: TrainerRef[];
  warnings: string[];
}

type CatalogGroup = { g: string; items: Array<[string, string, number, number, string]> };
type TrainerMap = Record<string, { datei: string; global: string; farben?: string; name?: string }>;

export function readPlanner(html: string): PlannerInfo {
  const warnings: string[] = [];
  const modules: CatalogModule[] = [];
  const catalog = extractConst(html, "CATALOG") as CatalogGroup[] | undefined;
  if (!Array.isArray(catalog)) warnings.push("Modulkatalog (CATALOG) nicht gefunden");
  for (const group of catalog ?? []) {
    for (const [name, examForm, cp, ls, code] of group.items ?? []) {
      modules.push({ name, examForm, cp: Number(cp) || 0, studySemester: Number(ls) || null, code: code ? code.toUpperCase() : null, area: group.g });
    }
  }

  const dates = extractConst(html, "EXAM_DATES_BEKANNT");
  const examDates = Array.isArray(dates) ? dates.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  if (!examDates.length) warnings.push("Prüfungstermine (EXAM_DATES_BEKANNT) nicht gefunden");

  const map = (extractConst(html, "TRAINER_MODULE") as TrainerMap | undefined) ?? {};
  const trainers = Object.entries(map).map(([code, t]) => ({
    code,
    file: t.datei,
    globalName: t.global,
    colorsName: t.farben ?? null,
    title: t.name ?? "Aufgabentrainer",
  }));
  return { modules, examDates, trainers, warnings };
}
