// Startseite: was vor der nächsten Prüfung noch offen ist (Material prüfen, Karten, Üben, Lernzeit)
import { db } from "../db";
import { studyProgress } from "./progress";

export interface Focus {
  exam: { id: string; title: string; date: string; days: number; moduleId: string | null; moduleCode: string | null } | null;
  todo: Array<{ key: "uncertain" | "dueCards" | "noMaterial" | "trainer" | "noTime"; count: number }>;
  minutes7: number;
}

const one = (sql: string, ...p: unknown[]) => (db().prepare(sql).get(...(p as string[])) as { n: number } | null)?.n ?? 0;

export function examFocus(): Focus {
  const next = studyProgress().nextExam;
  if (!next) return { exam: null, todo: [], minutes7: 0 };
  const m = next.module_id;
  const exam = { id: next.id, title: next.title, date: next.date!, days: next.days, moduleId: m, moduleCode: next.module_code };
  if (!m) return { exam, todo: [], minutes7: 0 };

  const uncertain = one("SELECT COUNT(*) AS n FROM material_items WHERE module_id = ? AND uncertain = 1", m);
  const dueCards = one(
    `SELECT COUNT(*) AS n FROM cards c JOIN documents d ON d.id = c.document_id LEFT JOIN progress p ON p.card_id = c.id
      WHERE d.module_id = ? AND (p.next_review IS NULL OR p.next_review <= datetime('now'))`,
    m
  );
  const noMaterial = one(
    `SELECT COUNT(*) AS n FROM documents d WHERE d.module_id = ? AND d.ocr_status = 'done' AND d.mime_type = 'application/pdf'
      AND NOT EXISTS (SELECT 1 FROM material_items mi WHERE mi.source_document_id = d.id)`,
    m
  );
  const trainer = one("SELECT COUNT(*) AS n FROM trainers WHERE module_id = ? AND enabled = 1", m);
  const minutes7 = one("SELECT COALESCE(SUM(minutes), 0) AS n FROM study_time WHERE module_id = ? AND date >= date('now', '-6 days')", m);

  // Reihenfolge = Wichtigkeit: Fehler im Material zuerst, dann Wiederholen, dann Üben
  const todo: Focus["todo"] = [];
  if (uncertain) todo.push({ key: "uncertain", count: uncertain });
  if (dueCards) todo.push({ key: "dueCards", count: dueCards });
  if (noMaterial) todo.push({ key: "noMaterial", count: noMaterial });
  if (trainer) todo.push({ key: "trainer", count: trainer });
  if (!minutes7 && exam.days <= 30) todo.push({ key: "noTime", count: 0 });
  return { exam, todo, minutes7 };
}
