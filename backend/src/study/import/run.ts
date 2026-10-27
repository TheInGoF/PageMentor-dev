// Einmaliger Import aus dem Studium Maker; idempotent über source_id, Probelauf rollt zurück
import { randomUUID } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { basename, join, resolve, sep } from "path";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { upsertMaterial, type MaterialKind } from "../material";
import { studyProgress, type StudyProgress } from "../progress";
import { splitCatalog } from "./catalog";
import { readPlanner, type CatalogModule, type TrainerRef } from "./planner";
import { readSources, type SmEntry, type SmHabit, type SmMaterial } from "./sources";

export interface Count {
  created: number;
  updated: number;
  skipped: number;
}

export interface ImportReport {
  dryRun: boolean;
  folder: string;
  modules: Count;
  assessments: Count;
  time: Count;
  material: Count;
  trainers: Count;
  examDates: Count;
  warnings: string[];
  progress: StudyProgress;
}

const count = (): Count => ({ created: 0, updated: 0, skipped: 0 });

const KIND: Record<string, string> = { klausur: "K", hausarbeit: "B", projekt: "P", labor: "L", muendlich: "M", sonstiges: "X", studienheft: "H" };
const STATUS: Record<string, string> = { inarbeit: "in_arbeit", nichtbestanden: "nicht_bestanden", geplant: "geplant", angemeldet: "angemeldet", bestanden: "bestanden", abgemeldet: "abgemeldet" };
const HABIT: Record<string, string> = { vorbereitung: "vorbereitung", geuebt: "trainer", gelernt: "lernen", gehoert: "hoeren" };
const MATERIAL: Record<string, MaterialKind> = { formeln: "formel", merksaetze: "merksatz", rezepte: "rezept", aufgaben: "aufgabe" };

class DryRunRollback extends Error {}

function moduleIndex(): { byCode: Map<string, string>; byName: Map<string, string> } {
  const rows = db().prepare("SELECT id, name, code FROM modules").all() as Array<{ id: string; name: string; code: string | null }>;
  return {
    byCode: new Map(rows.filter((r) => r.code).map((r) => [r.code!.toUpperCase(), r.id])),
    byName: new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id])),
  };
}

function importModules(mods: CatalogModule[], used: Set<string>, c: Count): void {
  const idx = moduleIndex();
  for (const m of mods) {
    const id = (m.code && idx.byCode.get(m.code)) || idx.byName.get(m.name.trim().toLowerCase());
    // Wahlmodule nur im Pfad, wenn es dazu schon Einträge gibt
    const inPath = (m.code && used.has(m.code)) || !/wahl/i.test(m.area) ? 1 : 0;
    if (id) {
      db()
        .prepare("UPDATE modules SET code = COALESCE(code, ?), cp = ?, study_semester = ?, exam_form = ?, area = ? WHERE id = ?")
        .run(m.code, m.cp, m.studySemester, m.examForm, m.area, id);
      c.updated++;
    } else {
      const newId = randomUUID();
      db()
        .prepare("INSERT INTO modules (id, name, code, cp, study_semester, exam_form, area, in_path, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '#3b82f6', ?)")
        .run(newId, m.name, m.code, m.cp, m.studySemester, m.examForm, m.area, inPath, m.studySemester ?? 99);
      if (m.code) idx.byCode.set(m.code, newId);
      idx.byName.set(m.name.trim().toLowerCase(), newId);
      c.created++;
    }
  }
}

function moduleFor(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const idx = moduleIndex();
  return idx.byCode.get(ref.trim().toUpperCase()) ?? idx.byName.get(ref.trim().toLowerCase()) ?? null;
}

function grade(v: SmEntry["grade"]): number | null {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  return typeof n === "number" && n >= 1 && n <= 5 ? n : null;
}

function day(v: string | null | undefined): string | null {
  return v && /^\d{4}-\d{2}(-\d{2})?$/.test(v) ? v : null;
}

function upsertBySource(table: string, sourceId: string, insert: () => void, update: () => void, c: Count): void {
  const exists = db().prepare(`SELECT 1 FROM ${table} WHERE source_id = ?`).get(sourceId);
  if (exists) {
    update();
    c.updated++;
  } else {
    insert();
    c.created++;
  }
}

function importEntries(entries: SmEntry[], c: Count, warnings: string[]): void {
  for (const e of entries) {
    if (!e?.id || !e.title) {
      c.skipped++;
      continue;
    }
    const kind = KIND[e.type] ?? "X";
    const status = STATUS[e.status] ?? "geplant";
    const moduleId = moduleFor(e.modul);
    if (e.modul && !moduleId) warnings.push(`Leistung „${e.title}“: Modul ${e.modul} unbekannt, ohne Modul übernommen`);
    const note = [e.heftcode ? `Heft ${e.heftcode}` : null, e.note || null].filter(Boolean).join(" · ") || null;
    const vals = [moduleId, kind, e.title, day(e.date) ?? day(e.month), status, Math.min(Math.max(Number(e.attempt) || 1, 1), 9), Number(e.cp) || 0, grade(e.grade), note];
    const src = `sm:${e.id}`;
    upsertBySource(
      "assessments",
      src,
      () =>
        db()
          .prepare("INSERT INTO assessments (id, module_id, kind, title, date, status, attempt, cp, grade, note, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(randomUUID(), ...vals, src),
      () =>
        db()
          .prepare("UPDATE assessments SET module_id = ?, kind = ?, title = ?, date = ?, status = ?, attempt = ?, cp = ?, grade = ?, note = ?, updated_at = datetime('now') WHERE source_id = ?")
          .run(...vals, src),
      c
    );
  }
}

function importHabits(habits: SmHabit[], c: Count): void {
  for (const h of habits) {
    if (!h?.id || !day(h.date)) {
      c.skipped++;
      continue;
    }
    const vals = [h.date, moduleFor(h.module), HABIT[h.kind] ?? "lernen", Math.min(Math.max(Math.round(Number(h.minutes) || 0), 0), 1440), h.note || null];
    const src = `sm:${h.id}`;
    upsertBySource(
      "study_time",
      src,
      () => db().prepare("INSERT INTO study_time (id, date, module_id, kind, minutes, note, origin, source_id) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)").run(randomUUID(), ...vals, src),
      () => db().prepare("UPDATE study_time SET date = ?, module_id = ?, kind = ?, minutes = ?, note = ? WHERE source_id = ?").run(...vals, src),
      c
    );
  }
}

// Pfad muss im gewählten Ordner bleiben
function inside(folder: string, rel: string): string | null {
  const abs = resolve(folder, rel);
  return abs.startsWith(resolve(folder) + sep) ? abs : null;
}

function importMaterial(folder: string, material: SmMaterial, c: Count, warnings: string[]): void {
  for (const [code, kinds] of Object.entries(material)) {
    const moduleId = moduleFor(code);
    for (const [key, files] of Object.entries(kinds ?? {})) {
      const kind = MATERIAL[key];
      if (!kind || !Array.isArray(files)) continue;
      for (const f of files) {
        const file = f.pfad ? inside(folder, f.pfad) : null;
        if (!file || !existsSync(file)) {
          warnings.push(`Katalog fehlt: ${f.pfad ?? f.datei ?? "?"}`);
          c.skipped++;
          continue;
        }
        const items = splitCatalog(readFileSync(file, "utf8"), code.toUpperCase(), kind);
        items.forEach((it, i) => {
          const existed = db().prepare("SELECT 1 FROM material_items WHERE id = ?").get(it.id);
          upsertMaterial({ id: it.id, module_id: moduleId, kind, title: it.title, body_md: it.body, category: it.category, sort_order: i, source_ref: f.titel ?? null });
          db().prepare("UPDATE material_items SET source_file = ? WHERE id = ?").run(f.pfad ?? null, it.id);
          if (existed) c.updated++;
          else c.created++;
        });
      }
    }
  }
}

function importTrainers(folder: string, trainers: TrainerRef[], dir: string, c: Count, warnings: string[], copies: Array<[string, string]>): void {
  for (const t of trainers) {
    const src = t.file ? inside(folder, t.file) : null;
    if (!src || !existsSync(src)) {
      warnings.push(`Trainer-Datei fehlt: ${t.file}`);
      c.skipped++;
      continue;
    }
    const file = basename(src);
    copies.push([src, join(dir, file)]);
    const vals = [moduleFor(t.code), `trainer/${file}`, t.title, t.globalName, t.colorsName];
    const sid = `sm:trainer:${t.code}`;
    upsertBySource(
      "trainers",
      sid,
      () => db().prepare("INSERT INTO trainers (id, module_id, file, title, global_name, colors_name, source_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), ...vals, sid),
      () => db().prepare("UPDATE trainers SET module_id = ?, file = ?, title = ?, global_name = ?, colors_name = ?, updated_at = datetime('now') WHERE source_id = ?").run(...vals, sid),
      c
    );
  }
}

function importExamDates(dates: string[], c: Count): void {
  for (const d of dates) {
    const r = db().prepare("INSERT OR IGNORE INTO exam_dates (date, kind) VALUES (?, 'klausur')").run(d);
    if (r.changes) c.created++;
    else c.skipped++;
  }
}

export function runImport(folder: string, opts: { dryRun?: boolean; trainerDir?: string } = {}): ImportReport {
  const dryRun = opts.dryRun ?? false;
  const trainerDir = opts.trainerDir ?? join(DATA_DIR, "trainer");
  const src = readSources(folder);
  const planner = src.plannerHtml ? readPlanner(src.plannerHtml) : { modules: [], examDates: [], trainers: [], warnings: [] };
  const report: ImportReport = {
    dryRun,
    folder,
    modules: count(),
    assessments: count(),
    time: count(),
    material: count(),
    trainers: count(),
    examDates: count(),
    warnings: [...src.warnings, ...planner.warnings],
    progress: null as unknown as StudyProgress,
  };
  const used = new Set(src.entries.map((e) => e.modul?.toUpperCase()).filter((x): x is string => !!x));
  const copies: Array<[string, string]> = [];

  const tx = db().transaction(() => {
    importModules(planner.modules, used, report.modules);
    importExamDates(planner.examDates, report.examDates);
    importEntries(src.entries, report.assessments, report.warnings);
    importHabits(src.habits, report.time);
    importMaterial(folder, src.material, report.material, report.warnings);
    importTrainers(folder, planner.trainers, trainerDir, report.trainers, report.warnings, copies);
    report.progress = studyProgress();
    if (dryRun) throw new DryRunRollback();
  });
  try {
    tx();
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }

  if (!dryRun && copies.length) {
    mkdirSync(trainerDir, { recursive: true });
    for (const [from, to] of copies) copyFileSync(from, to);
  }
  return report;
}
