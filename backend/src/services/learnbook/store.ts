// Lernhörbuch: Einheiten je Heft mit Quelltext, Skript, Merkpunkten, Prüfnotiz und (ab Schritt 4) Audio.
// Steht neben dem normalen Hörbuch, ersetzt es nicht
import type { Database } from "bun:sqlite";
import { db } from "../../db";

export type LearnKind = "language" | "subject";

export interface LearnUnit {
  document_id: string;
  idx: number;
  title: string | null;
  start_page: number;
  end_page: number;
  source: string;
  script: string | null;
  // JSON-Liste der wichtigsten Punkte, für Wiederholungen in späteren Einheiten
  points: string | null;
  // Ergebnis des Prüfdurchgangs (Fachhefte): gefundene Abweichungen und ob korrigiert
  check_note: string | null;
  model: string | null;
  script_stamp: string | null;
  audio_path: string | null;
  audio_stamp: string | null;
  duration_ms: number | null;
}

export function ensureLearnTables(d: Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS learn_units (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      title TEXT,
      start_page INTEGER NOT NULL DEFAULT 0,
      end_page INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      script TEXT,
      points TEXT,
      check_note TEXT,
      model TEXT,
      script_stamp TEXT,
      audio_path TEXT,
      audio_stamp TEXT,
      duration_ms INTEGER,
      PRIMARY KEY (document_id, idx)
    );
  `);
  const cols = d.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  // Art des Lernhörbuchs und Zielsprache (Sprachkurs); leer = aus dem Heft geschätzt
  if (!cols.some((c) => c.name === "learn_kind")) d.exec("ALTER TABLE documents ADD COLUMN learn_kind TEXT");
  if (!cols.some((c) => c.name === "learn_lang")) d.exec("ALTER TABLE documents ADD COLUMN learn_lang TEXT");
}

export function listUnits(docId: string): LearnUnit[] {
  return db().prepare("SELECT * FROM learn_units WHERE document_id = ? ORDER BY idx").all(docId) as LearnUnit[];
}

// Neue Einteilung übernehmen: gleiche Quelle behält Skript und Audio, geänderte Einheiten werden neu
export function syncUnits(docId: string, units: Array<{ source: string; start_page: number; end_page: number }>): void {
  const d = db();
  const old = new Map(listUnits(docId).map((u) => [u.idx, u]));
  d.transaction(() => {
    units.forEach((u, idx) => {
      const prev = old.get(idx);
      if (prev && prev.source === u.source) return;
      d.prepare(
        `INSERT OR REPLACE INTO learn_units (document_id, idx, title, start_page, end_page, source) VALUES (?, ?, NULL, ?, ?, ?)`
      ).run(docId, idx, u.start_page, u.end_page, u.source);
    });
    d.prepare("DELETE FROM learn_units WHERE document_id = ? AND idx >= ?").run(docId, units.length);
  })();
}

export function saveScript(docId: string, idx: number, r: { title: string; script: string; points: string[]; checkNote: string | null; model: string; stamp: string }): void {
  db()
    .prepare("UPDATE learn_units SET title = ?, script = ?, points = ?, check_note = ?, model = ?, script_stamp = ? WHERE document_id = ? AND idx = ?")
    .run(r.title, r.script, JSON.stringify(r.points), r.checkNote, r.model, r.stamp, docId, idx);
}

export function learnSettings(docId: string): { kind: LearnKind; lang: string } {
  const r = db().prepare("SELECT learn_kind, learn_lang, second_language FROM documents WHERE id = ?").get(docId) as
    | { learn_kind: string | null; learn_lang: string | null; second_language: string | null }
    | undefined;
  // Ohne Wahl: ein Heft mit zweiter Sprache ist ein Sprachkurs
  const kind: LearnKind = r?.learn_kind === "language" || r?.learn_kind === "subject" ? r.learn_kind : r?.second_language ? "language" : "subject";
  return { kind, lang: r?.learn_lang || r?.second_language || "es" };
}
