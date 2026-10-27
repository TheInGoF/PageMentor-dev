// Leistungen: Klausuren, Einsendeaufgaben, Labore, Projekte; Termine, Versuche, Noten
import { randomUUID } from "crypto";
import { db } from "../db";

export const ASSESSMENT_KINDS = ["K", "B", "L", "S", "P", "A", "M", "X"] as const;
export const ASSESSMENT_STATUS = ["geplant", "angemeldet", "bestanden", "nicht_bestanden", "abgemeldet"] as const;

export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];
export type AssessmentStatus = (typeof ASSESSMENT_STATUS)[number];

export interface Assessment {
  id: string;
  module_id: string | null;
  kind: AssessmentKind;
  title: string;
  date: string | null;
  status: AssessmentStatus;
  attempt: number;
  cp: number;
  grade: number | null;
  note: string | null;
  source_id: string | null;
}

export type AssessmentInput = Partial<Omit<Assessment, "id">> & { title: string };

const DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;

export class StudyInputError extends Error {}

function validate(a: Partial<Assessment>): void {
  if (a.kind !== undefined && !ASSESSMENT_KINDS.includes(a.kind)) throw new StudyInputError(`Unbekannte Art: ${a.kind}`);
  if (a.status !== undefined && !ASSESSMENT_STATUS.includes(a.status)) throw new StudyInputError(`Unbekannter Status: ${a.status}`);
  if (a.date != null && !DATE_RE.test(a.date)) throw new StudyInputError(`Datum als JJJJ-MM-TT oder JJJJ-MM: ${a.date}`);
  if (a.grade != null && (a.grade < 1 || a.grade > 5)) throw new StudyInputError(`Note zwischen 1,0 und 5,0: ${a.grade}`);
  if (a.attempt !== undefined && (a.attempt < 1 || a.attempt > 9)) throw new StudyInputError(`Versuch 1 bis 9: ${a.attempt}`);
}

export function listAssessments(moduleId?: string): Assessment[] {
  const sql = "SELECT * FROM assessments" + (moduleId ? " WHERE module_id = ?" : "") + " ORDER BY COALESCE(date, '9999'), title";
  return (moduleId ? db().prepare(sql).all(moduleId) : db().prepare(sql).all()) as Assessment[];
}

export function getAssessment(id: string): Assessment | null {
  return (db().prepare("SELECT * FROM assessments WHERE id = ?").get(id) as Assessment) ?? null;
}

export function createAssessment(input: AssessmentInput): Assessment {
  validate(input);
  if (!input.title.trim()) throw new StudyInputError("Titel fehlt");
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO assessments (id, module_id, kind, title, date, status, attempt, cp, grade, note, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.module_id ?? null,
      input.kind ?? "K",
      input.title.trim(),
      input.date ?? null,
      input.status ?? "geplant",
      input.attempt ?? 1,
      input.cp ?? 0,
      input.grade ?? null,
      input.note ?? null,
      input.source_id ?? null
    );
  return getAssessment(id)!;
}

const EDITABLE = ["module_id", "kind", "title", "date", "status", "attempt", "cp", "grade", "note"] as const;

export function updateAssessment(id: string, patch: Partial<Assessment>): Assessment {
  if (!getAssessment(id)) throw new StudyInputError("Leistung nicht gefunden");
  validate(patch);
  const keys = EDITABLE.filter((k) => patch[k] !== undefined);
  if (keys.length) {
    db()
      .prepare(`UPDATE assessments SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
      .run(...keys.map((k) => patch[k] as string | number | null), id);
  }
  return getAssessment(id)!;
}

export function deleteAssessment(id: string): boolean {
  return db().prepare("DELETE FROM assessments WHERE id = ?").run(id).changes > 0;
}

// Nicht bestanden: nächster Versuch als neue geplante Leistung, Termin offen
export function scheduleRetry(id: string): Assessment {
  const a = getAssessment(id);
  if (!a) throw new StudyInputError("Leistung nicht gefunden");
  if (a.status !== "nicht_bestanden") throw new StudyInputError("Nur nach nicht bestandenem Versuch");
  return createAssessment({ module_id: a.module_id, kind: a.kind, title: a.title, attempt: a.attempt + 1, status: "geplant" });
}
