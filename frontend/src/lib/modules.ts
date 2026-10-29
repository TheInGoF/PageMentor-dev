// Gemeinsame Helfer für Module: Fachsemester, Schwerpunkte, Gruppierung
import type { Module } from "./api";

// Fachsemester als Zahl: aus der Prüfungsordnung, sonst aus dem alten Textfeld („Semester 2“)
export function semesterOf(m: Pick<Module, "study_semester" | "semester">): number | null {
  if (m.study_semester != null) return m.study_semester;
  const n = /\d+/.exec(m.semester ?? "")?.[0];
  return n ? Number(n) : null;
}

export function distinctSemesters(mods: Module[]): number[] {
  return [...new Set(mods.map(semesterOf).filter((n): n is number => n != null))].sort((a, b) => a - b);
}

export function distinctAreas(mods: Module[]): string[] {
  return [...new Set(mods.map((m) => m.area?.trim()).filter((a): a is string => !!a))].sort((a, b) => a.localeCompare(b));
}

// Nach Fachsemester gruppiert, ohne Semester zuletzt
export function groupBySemester<T extends Module>(mods: T[]): Array<{ semester: number | null; modules: T[] }> {
  const map = new Map<number | null, T[]>();
  for (const m of mods) {
    const s = semesterOf(m);
    map.set(s, [...(map.get(s) ?? []), m]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a ?? 99) - (b ?? 99))
    .map(([semester, modules]) => ({ semester, modules }));
}
