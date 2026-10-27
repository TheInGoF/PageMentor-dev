// Prüfungstermine (bekannt + fortgeschrieben) und Verschieben mit Nachrücken (aus dem alten Planer)
import { db } from "../db";
import { getAssessment, StudyInputError, type Assessment } from "./assessments";

export interface ExamSlot {
  date: string;
  // Aus dem Rhythmus errechnet, von der Hochschule noch nicht veröffentlicht (TBA)
  estimate: boolean;
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Muster des letzten bekannten Jahres fortschreiben: gleicher Tag im Jahr, dann nächster Samstag
export function examSlots(known: string[], untilYear: number): ExamSlot[] {
  const sorted = [...new Set(known)].sort();
  const out: ExamSlot[] = sorted.map((date) => ({ date, estimate: false }));
  if (!sorted.length) return out;
  const lastYear = Number(sorted[sorted.length - 1].slice(0, 4));
  const pattern = sorted
    .filter((d) => d.startsWith(String(lastYear)))
    .map((d) => Math.round((Date.parse(d) - Date.UTC(lastYear, 0, 1)) / DAY));
  for (let year = lastYear + 1; year <= untilYear; year++) {
    for (const dayOfYear of pattern) {
      let d = new Date(Date.UTC(year, 0, 1) + dayOfYear * DAY);
      while (d.getUTCDay() !== 6) d = new Date(d.getTime() + DAY);
      out.push({ date: iso(d), estimate: true });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function allExamSlots(): ExamSlot[] {
  const known = (db().prepare("SELECT date FROM exam_dates ORDER BY date").all() as Array<{ date: string }>).map((r) => r.date);
  return examSlots(known, new Date().getFullYear() + 6);
}

export interface ShiftStep {
  id: string;
  title: string;
  from: string;
  to: string;
  estimate: boolean;
}

const MOVABLE = new Set(["geplant", "in_arbeit"]);

// Klausur einen Termin nach hinten; geplante Klausuren auf dem Ziel rücken je einen Termin weiter.
// Angemeldete und bestandene bleiben stehen; dann teilen sich zwei Klausuren den Termin (Warnung).
export function planShift(all: Assessment[], id: string, slots: ExamSlot[]): { steps: ShiftStep[]; warnings: string[] } {
  const start = all.find((a) => a.id === id);
  if (!start?.date || start.date.length !== 10) throw new StudyInputError("Leistung hat kein Prüfungsdatum");
  const steps: ShiftStep[] = [];
  const warnings: string[] = [];
  let current: Assessment | null = start;
  let date = start.date;
  while (current) {
    const next = slots.find((s) => s.date > date);
    if (!next) throw new StudyInputError("Kein weiterer Prüfungstermin bekannt");
    steps.push({ id: current.id, title: current.title, from: current.date!, to: next.date, estimate: next.estimate });
    const there: Assessment[] = all.filter((a) => a.date === next.date && a.kind === "K" && a.id !== current!.id && a.status !== "abgemeldet" && !steps.some((s) => s.id === a.id));
    const mover: Assessment | null = there.find((a) => MOVABLE.has(a.status)) ?? null;
    for (const a of there) if (a !== mover) warnings.push(`${next.date} bleibt zusätzlich durch „${a.title}“ belegt`);
    date = next.date;
    current = mover;
  }
  return { steps, warnings };
}

export function shiftAssessment(id: string, apply: boolean): { steps: ShiftStep[]; warnings: string[] } {
  const all = db().prepare("SELECT * FROM assessments").all() as Assessment[];
  const plan = planShift(all, id, allExamSlots());
  if (apply) {
    const upd = db().prepare("UPDATE assessments SET date = ?, updated_at = datetime('now') WHERE id = ?");
    db().transaction(() => plan.steps.forEach((s) => upd.run(s.to, s.id)))();
  }
  return plan;
}

export const MAX_ATTEMPTS = 3;

// Folgeversuch existiert schon? Dann nicht doppelt anlegen
export function followUp(a: Assessment): Assessment | null {
  return (db()
    .prepare("SELECT * FROM assessments WHERE id != ? AND title = ? AND COALESCE(module_id, '') = COALESCE(?, '') AND attempt = ? LIMIT 1")
    .get(a.id, a.title, a.module_id, a.attempt + 1) as Assessment) ?? null;
}

export function retryTarget(id: string): Assessment {
  const a = getAssessment(id);
  if (!a) throw new StudyInputError("Leistung nicht gefunden");
  if (a.attempt >= MAX_ATTEMPTS) throw new StudyInputError(`${a.attempt}. Versuch: keine weiteren Versuche möglich, bitte mit dem Prüfungsamt klären`);
  return a;
}
