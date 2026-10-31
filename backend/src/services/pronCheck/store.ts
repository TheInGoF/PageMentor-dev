// Befunde der Ausspracheprüfung: je Kapitel ein Lauf, je Stelle ein Befund mit Status
// (offen, gelöst = grüner Haken, ignoriert). Gelöste Befunde sind die Lernbeispiele für Gemma
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { db } from "../../db";
import type { Finding } from "./align";

export function ensurePronTables(d: Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS pron_checks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      words INTEGER NOT NULL DEFAULT 0,
      duration REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS pron_issues (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL REFERENCES pron_checks(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      expected TEXT NOT NULL,
      heard TEXT NOT NULL,
      start REAL NOT NULL,
      end REAL NOT NULL,
      prob REAL NOT NULL,
      context TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      note TEXT,
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS pron_issues_doc ON pron_issues(document_id, status);
  `);
  // Was Gemma aus dem gelösten Befund gelernt hat: Hinweis, "-" = nichts Neues, NULL = noch nicht gefragt
  const cols = d.prepare("PRAGMA table_info(pron_issues)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "learned")) d.exec("ALTER TABLE pron_issues ADD COLUMN learned TEXT");
}

// Neuer Lauf für ein Kapitel ersetzt dessen offene Befunde; gelöste und ignorierte bleiben als Verlauf
export function saveCheck(docId: string, chapterId: string, findings: Finding[], words: number, duration: number): string {
  const d = db();
  const id = randomUUID();
  d.transaction(() => {
    d.prepare("DELETE FROM pron_issues WHERE chapter_id = ? AND status = 'open'").run(chapterId);
    d.prepare("INSERT INTO pron_checks (id, document_id, chapter_id, created_at, words, duration) VALUES (?, ?, ?, ?, ?, ?)").run(id, docId, chapterId, Date.now(), words, duration);
    const ins = d.prepare(
      "INSERT INTO pron_issues (id, check_id, document_id, chapter_id, kind, expected, heard, start, end, prob, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    // Schon gelöste oder ignorierte gleiche Stellen nicht wieder melden
    const known = new Set(
      (d.prepare("SELECT expected, heard FROM pron_issues WHERE chapter_id = ? AND status != 'open'").all(chapterId) as Array<{ expected: string; heard: string }>).map(
        (r) => `${r.expected}|${r.heard}`
      )
    );
    for (const f of findings) {
      if (known.has(`${f.expected}|${f.heard}`)) continue;
      ins.run(randomUUID(), id, docId, chapterId, f.kind, f.expected, f.heard, f.start, f.end, f.prob, f.context);
    }
  })();
  return id;
}

export interface IssueRow {
  id: string;
  chapter_id: string;
  chapter_title: string;
  chapter_number: number;
  kind: Finding["kind"];
  expected: string;
  heard: string;
  start: number;
  end: number;
  prob: number;
  context: string;
  status: "open" | "resolved" | "ignored";
  note: string | null;
  learned: string | null;
}

export function listIssues(docId: string): IssueRow[] {
  return db()
    .prepare(
      `SELECT i.id, i.chapter_id, c.title AS chapter_title, c.number AS chapter_number, i.kind, i.expected, i.heard, i.start, i.end, i.prob,
              i.context, i.status, i.note, i.learned
         FROM pron_issues i JOIN chapters c ON c.id = i.chapter_id
        WHERE i.document_id = ? ORDER BY c.sort_order, c.number, i.start`
    )
    .all(docId) as IssueRow[];
}

export function getIssue(id: string): (IssueRow & { document_id: string }) | null {
  return (
    (db()
      .prepare(
        `SELECT i.*, c.title AS chapter_title, c.number AS chapter_number FROM pron_issues i JOIN chapters c ON c.id = i.chapter_id WHERE i.id = ?`
      )
      .get(id) as (IssueRow & { document_id: string }) | undefined) ?? null
  );
}

export function setIssueStatus(id: string, status: IssueRow["status"], note?: string): void {
  db()
    .prepare("UPDATE pron_issues SET status = ?, note = COALESCE(?, note), resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END WHERE id = ?")
    .run(status, note ?? null, status, Date.now(), id);
}

// Je Kapitel des Hefts: Audio vorhanden, zuletzt geprüft, offene Befunde
export function chapterOverview(docId: string): Array<{ id: string; number: number; title: string; hasAudio: boolean; checkedAt: number | null; open: number }> {
  return db()
    .prepare(
      `SELECT c.id, c.number, c.title,
              EXISTS(SELECT 1 FROM audio a WHERE a.chapter_id = c.id AND a.status = 'done') AS hasAudio,
              (SELECT MAX(created_at) FROM pron_checks p WHERE p.chapter_id = c.id) AS checkedAt,
              (SELECT COUNT(*) FROM pron_issues i WHERE i.chapter_id = c.id AND i.status = 'open') AS open
         FROM chapters c WHERE c.document_id = ? ORDER BY c.sort_order, c.number`
    )
    .all(docId)
    .map((r) => {
      const x = r as { id: string; number: number; title: string; hasAudio: number; checkedAt: number | null; open: number };
      return { ...x, hasAudio: !!x.hasAudio };
    });
}
