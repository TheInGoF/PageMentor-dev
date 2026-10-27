// Studienfortschritt: CP, CP-gewichteter Schnitt, nächste Prüfung, offene Module
import { db } from "../db";
import type { Assessment } from "./assessments";

export interface StudyProgress {
  earnedCp: number;
  totalCp: number | null;
  average: number | null;
  passedModules: number;
  openModules: number;
  nextExam: (Assessment & { module_code: string | null; days: number }) | null;
}

interface ModuleRow {
  id: string;
  code: string | null;
  cp: number | null;
  in_path: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export function profileValue(key: string): string | null {
  return (db().prepare("SELECT value FROM study_profile WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
}

export function setProfileValue(key: string, value: string | null): void {
  if (value === null) db().prepare("DELETE FROM study_profile WHERE key = ?").run(key);
  else db().prepare("INSERT INTO study_profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function studyProgress(): StudyProgress {
  const modules = db().prepare("SELECT id, code, cp, in_path FROM modules").all() as ModuleRow[];
  // Studienhefte (H) zählen nicht für CP und Schnitt
  const passed = db().prepare("SELECT * FROM assessments WHERE status = 'bestanden' AND kind != 'H'").all() as Assessment[];

  // Je Modul zählen die CP einmal; Leistung ohne CP übernimmt die CP des Moduls
  const byModule = new Map<string, number>();
  let looseCp = 0;
  let gradeSum = 0;
  let gradeCp = 0;
  const moduleCp = new Map(modules.map((m) => [m.id, m.cp ?? 0]));
  for (const a of passed) {
    const cp = a.cp > 0 ? a.cp : a.module_id ? moduleCp.get(a.module_id) ?? 0 : 0;
    if (a.module_id) byModule.set(a.module_id, (byModule.get(a.module_id) ?? 0) + cp);
    else looseCp += cp;
    if (a.grade != null && cp > 0) {
      gradeSum += a.grade * cp;
      gradeCp += cp;
    }
  }
  const earnedCp = [...byModule.entries()].reduce((s, [id, cp]) => s + Math.min(cp, moduleCp.get(id) || cp), 0) + looseCp;

  const next = db()
    .prepare(
      `SELECT a.*, m.code AS module_code FROM assessments a LEFT JOIN modules m ON m.id = a.module_id
       WHERE a.status IN ('geplant', 'angemeldet') AND a.kind != 'H' AND length(a.date) = 10 AND a.date >= ?
       ORDER BY a.date LIMIT 1`
    )
    .get(today()) as (Assessment & { module_code: string | null }) | undefined;

  const total = profileValue("total_cp");
  const pathModules = modules.filter((m) => m.in_path && m.code);
  return {
    earnedCp: Math.round(earnedCp * 10) / 10,
    totalCp: total ? Number(total) : null,
    average: gradeCp ? Math.round((gradeSum / gradeCp) * 100) / 100 : null,
    passedModules: pathModules.filter((m) => byModule.has(m.id)).length,
    openModules: pathModules.filter((m) => !byModule.has(m.id)).length,
    nextExam: next ? { ...next, days: Math.round((Date.parse(next.date!) - Date.parse(today())) / 86_400_000) } : null,
  };
}
