import Database from "better-sqlite3";
import { join } from "path";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";
const DB_PATH = join(DATA_DIR, "pagementor.db");

let _db: Database.Database;

export function db(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
  }
  return _db;
}

export function initDb() {
  const d = db();

  d.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER NOT NULL DEFAULT 0,
      ocr_text TEXT,
      ocr_status TEXT NOT NULL DEFAULT 'pending',
      language TEXT NOT NULL DEFAULT 'de',
      type TEXT NOT NULL DEFAULT 'studienheft',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_tags (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (document_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      start_page INTEGER NOT NULL DEFAULT 1,
      end_page INTEGER NOT NULL DEFAULT 1,
      text TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audio (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      stored_path TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      engine TEXT NOT NULL DEFAULT 'edge-tts',
      voice TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      hint TEXT,
      difficulty TEXT NOT NULL DEFAULT 'medium',
      source_page INTEGER,
      source TEXT NOT NULL DEFAULT 'extracted',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS progress (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      next_review TEXT NOT NULL DEFAULT (datetime('now')),
      ease REAL NOT NULL DEFAULT 2.5,
      reps INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      level TEXT NOT NULL DEFAULT 'bullets',
      content TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS exam_sessions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      card_ids_json TEXT NOT NULL DEFAULT '[]',
      answers_json TEXT NOT NULL DEFAULT '{}',
      score INTEGER,
      total INTEGER NOT NULL DEFAULT 0,
      planned_duration_ms INTEGER,
      taken_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
  `);

  console.log("Database ready:", DB_PATH);
}
