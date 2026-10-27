// Trainer-Register: Dateien liegen im Datenordner, die App liefert sie nur aus
import { existsSync, readFileSync } from "fs";
import { resolve, sep } from "path";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { checkTrainer, type TrainerCheck } from "./check";

export interface TrainerRow {
  id: string;
  module_id: string | null;
  file: string;
  title: string;
  enabled: number;
  global_name: string | null;
  colors_name: string | null;
}

export function listTrainers(moduleId?: string): TrainerRow[] {
  const sql = "SELECT id, module_id, file, title, enabled, global_name, colors_name FROM trainers" + (moduleId ? " WHERE module_id = ?" : "") + " ORDER BY title";
  return (moduleId ? db().prepare(sql).all(moduleId) : db().prepare(sql).all()) as TrainerRow[];
}

export function getTrainer(id: string): TrainerRow | null {
  return (db().prepare("SELECT id, module_id, file, title, enabled, global_name, colors_name FROM trainers WHERE id = ?").get(id) as TrainerRow) ?? null;
}

// Nur Dateien unter DATA_DIR/trainer, nie ein beliebiger Pfad aus der DB
export function trainerSource(t: TrainerRow, dataDir = DATA_DIR): string | null {
  const base = resolve(dataDir, "trainer");
  const abs = resolve(dataDir, t.file);
  if (!abs.startsWith(base + sep) || !existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
}

export function selfTest(t: TrainerRow, dataDir = DATA_DIR, runs?: number): TrainerCheck {
  const src = trainerSource(t, dataDir);
  if (!src) return { ok: false, generators: 0, runs: 0, problems: [`Datei fehlt: ${t.file}`] };
  if (!t.global_name) return { ok: false, generators: 0, runs: 0, problems: ["Name der Generator-Liste fehlt"] };
  return checkTrainer(src, t.global_name, t.colors_name, runs);
}
