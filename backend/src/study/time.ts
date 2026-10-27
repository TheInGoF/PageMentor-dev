// Lernzeit: von Hand oder automatisch gebucht, je Tag und Modul
import { randomUUID } from "crypto";
import { db } from "../db";
import { StudyInputError } from "./assessments";

export const TIME_KINDS = ["lernen", "trainer", "karten", "hoeren", "pruefung", "vorbereitung"] as const;
export type TimeKind = (typeof TIME_KINDS)[number];

export interface StudyTime {
  id: string;
  date: string;
  module_id: string | null;
  kind: TimeKind;
  minutes: number;
  note: string | null;
  origin: "manual" | "auto";
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// Mehr als ein Tag ist ein Tippfehler
const MAX_MINUTES = 24 * 60;

export function addTime(input: Omit<StudyTime, "id" | "origin" | "note"> & { note?: string | null; origin?: "manual" | "auto"; source_id?: string }): StudyTime {
  if (!DAY_RE.test(input.date)) throw new StudyInputError(`Datum als JJJJ-MM-TT: ${input.date}`);
  if (!TIME_KINDS.includes(input.kind)) throw new StudyInputError(`Unbekannte Art: ${input.kind}`);
  if (!(input.minutes > 0 && input.minutes <= MAX_MINUTES)) throw new StudyInputError(`Minuten 1 bis ${MAX_MINUTES}`);
  const id = randomUUID();
  db()
    .prepare("INSERT INTO study_time (id, date, module_id, kind, minutes, note, origin, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, input.date, input.module_id ?? null, input.kind, Math.round(input.minutes), input.note ?? null, input.origin ?? "manual", input.source_id ?? null);
  return db().prepare("SELECT * FROM study_time WHERE id = ?").get(id) as StudyTime;
}

export function deleteTime(id: string): boolean {
  return db().prepare("DELETE FROM study_time WHERE id = ?").run(id).changes > 0;
}

export function listTime(from: string, to: string, moduleId?: string): StudyTime[] {
  const sql = "SELECT * FROM study_time WHERE date BETWEEN ? AND ?" + (moduleId ? " AND module_id = ?" : "") + " ORDER BY date, created_at";
  return (moduleId ? db().prepare(sql).all(from, to, moduleId) : db().prepare(sql).all(from, to)) as StudyTime[];
}

// Summen je Tag für die Heatmap
export function minutesPerDay(from: string, to: string): Array<{ date: string; minutes: number }> {
  return db()
    .prepare("SELECT date, SUM(minutes) AS minutes FROM study_time WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date")
    .all(from, to) as Array<{ date: string; minutes: number }>;
}

export function minutesPerModule(from: string, to: string): Array<{ module_id: string | null; minutes: number }> {
  return db()
    .prepare("SELECT module_id, SUM(minutes) AS minutes FROM study_time WHERE date BETWEEN ? AND ? GROUP BY module_id ORDER BY minutes DESC")
    .all(from, to) as Array<{ module_id: string | null; minutes: number }>;
}
