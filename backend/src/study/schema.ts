// Studien-Datenmodell: Module mit Kürzel und CP, Leistungen, Lernzeit, Material, Trainer
// Versioniert über PRAGMA user_version, vor jeder Hochstufung ein Backup der DB
import type { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

export const STUDY_SCHEMA_VERSION = 1;

function columns(d: Database, table: string): Set<string> {
  return new Set((d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
}

function addColumns(d: Database, table: string, defs: Record<string, string>): void {
  const have = columns(d, table);
  for (const [name, def] of Object.entries(defs)) {
    if (!have.has(name)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}

function migrateV1(d: Database): void {
  // Modul aus der Prüfungsordnung; Status und Note kommen aus den Leistungen
  addColumns(d, "modules", {
    code: "TEXT",
    cp: "REAL",
    study_semester: "INTEGER",
    exam_form: "TEXT",
    area: "TEXT",
    // Sammelmodul, zu dem dieses Teilmodul gehört (Kürzel)
    parent_code: "TEXT",
    // Teil des eigenen Studienpfads (Vertiefung)
    in_path: "INTEGER NOT NULL DEFAULT 1",
  });
  d.exec("CREATE UNIQUE INDEX IF NOT EXISTS modules_code ON modules(code) WHERE code IS NOT NULL");

  d.exec(`
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,
      -- K Klausur, B Einsendeaufgabe, L Labor, S Studienleistung, P Projekt, A Abschluss, M mündlich, X Sonstiges
      kind TEXT NOT NULL DEFAULT 'K',
      title TEXT NOT NULL,
      -- Termin als JJJJ-MM-TT, oder nur Monat JJJJ-MM wenn noch offen
      date TEXT,
      status TEXT NOT NULL DEFAULT 'geplant',
      attempt INTEGER NOT NULL DEFAULT 1,
      cp REAL NOT NULL DEFAULT 0,
      grade REAL,
      note TEXT,
      source_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS assessments_module ON assessments(module_id);
    CREATE UNIQUE INDEX IF NOT EXISTS assessments_source ON assessments(source_id) WHERE source_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS study_time (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,
      -- lernen, trainer, karten, hoeren, pruefung, vorbereitung
      kind TEXT NOT NULL DEFAULT 'lernen',
      minutes INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      -- manual oder auto (vom Trainer, von Karten, vom Player gebucht)
      origin TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS study_time_date ON study_time(date);
    CREATE UNIQUE INDEX IF NOT EXISTS study_time_source ON study_time(source_id) WHERE source_id IS NOT NULL;

    -- Ein Eintrag aus den Katalogen; id ist die Grep-ID, z. B. MOD-F-HEFT1-05
    CREATE TABLE IF NOT EXISTS material_items (
      id TEXT PRIMARY KEY,
      module_id TEXT REFERENCES modules(id) ON DELETE CASCADE,
      -- aufgabe, rezept, merksatz, formel
      kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body_md TEXT NOT NULL DEFAULT '',
      category TEXT,
      source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
      source_ref TEXT,
      uncertain INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS material_module_kind ON material_items(module_id, kind);

    -- Trainer-Dateien im Datenordner; die App lädt sie abgeschirmt
    CREATE TABLE IF NOT EXISTS trainers (
      id TEXT PRIMARY KEY,
      module_id TEXT REFERENCES modules(id) ON DELETE CASCADE,
      file TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Prüfungstermine der Hochschule (z. B. Prüfungssamstage)
    CREATE TABLE IF NOT EXISTS exam_dates (
      date TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'klausur',
      capacity INTEGER NOT NULL DEFAULT 2
    );

    -- Studiengang: Name, Prüfungsordnung, Gesamt-CP
    CREATE TABLE IF NOT EXISTS study_profile (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

const MIGRATIONS: Array<(d: Database) => void> = [migrateV1];

// Sicherung vor der Hochstufung; nur wenn schon Daten da sind
function backup(d: Database, dataDir: string, from: number): string | null {
  const dbFile = join(dataDir, "pagementor.db");
  if (!existsSync(dbFile)) return null;
  const hasData = (d.prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number }).n > 0;
  if (!hasData) return null;
  const dir = join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  d.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const target = join(dir, `pagementor-v${from}-${new Date().toISOString().slice(0, 10)}.db`);
  if (!existsSync(target)) copyFileSync(dbFile, target);
  return target;
}

// Gibt die erreichte Version und ggf. den Backup-Pfad zurück
export function migrateStudy(d: Database, dataDir: string): { version: number; backup: string | null } {
  const current = (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (current >= STUDY_SCHEMA_VERSION) return { version: current, backup: null };
  const saved = backup(d, dataDir, current);
  const run = d.transaction(() => {
    for (let v = current; v < STUDY_SCHEMA_VERSION; v++) MIGRATIONS[v](d);
    d.exec(`PRAGMA user_version = ${STUDY_SCHEMA_VERSION}`);
  });
  run();
  return { version: STUDY_SCHEMA_VERSION, backup: saved };
}
