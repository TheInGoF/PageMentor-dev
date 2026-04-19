import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";
const DB_PATH = join(DATA_DIR, "pagementor.db");

let _db: Database;

export function db(): Database {
  if (!_db) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    _db = new Database(DB_PATH, { create: true });
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
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
      ocr_status TEXT NOT NULL DEFAULT 'awaiting-extraction',
      language TEXT NOT NULL DEFAULT 'de',
      type TEXT NOT NULL DEFAULT 'studienheft',
      thumb_page INTEGER NOT NULL DEFAULT 1,
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
      generation_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      semester TEXT,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#ef4444',
      icon TEXT NOT NULL DEFAULT '📘',
      sort_order INTEGER NOT NULL DEFAULT 0,
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

  // Migrations (idempotent) — add module_id / thumb_page to documents if not there yet.
  const cols = d.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "module_id")) {
    d.exec("ALTER TABLE documents ADD COLUMN module_id TEXT REFERENCES modules(id) ON DELETE SET NULL");
  }
  if (!cols.some((c) => c.name === "thumb_page")) {
    d.exec("ALTER TABLE documents ADD COLUMN thumb_page INTEGER NOT NULL DEFAULT 1");
  }
  if (!cols.some((c) => c.name === "extraction_started_at")) {
    // Epoch-ms. Wird beim Extraktionsstart gesetzt und beim Ende
    // (done / failed) wieder auf NULL. Erlaubt es dem Frontend, nach
    // einem Reload weiterhin die richtige Laufzeit anzuzeigen statt
    // den Timer bei 0 neu zu starten.
    d.exec("ALTER TABLE documents ADD COLUMN extraction_started_at INTEGER");
  }

  const summaryCols = d.prepare("PRAGMA table_info(summaries)").all() as Array<{ name: string }>;
  if (!summaryCols.some((c) => c.name === "generation_ms")) {
    d.exec("ALTER TABLE summaries ADD COLUMN generation_ms INTEGER NOT NULL DEFAULT 0");
  }

  const chapterCols = d.prepare("PRAGMA table_info(chapters)").all() as Array<{ name: string }>;
  if (!chapterCols.some((c) => c.name === "kind")) {
    // Art des Abschnitts — steuert welche Features ihn nutzen. Default
    // "content" für alte Rows; neu extrahierte Docs kriegen die
    // Klassifikation direkt aus dem Docling-Parser.
    d.exec("ALTER TABLE chapters ADD COLUMN kind TEXT NOT NULL DEFAULT 'content'");
  }
  if (!chapterCols.some((c) => c.name === "audio_text")) {
    // LLM-vorverarbeiteter Kapiteltext, optimiert für TTS:
    // Abkürzungen ausgeschrieben, Formeln verbalisiert, Zitate
    // entfernt etc. NULL = noch nicht generiert; bei Re-Extraktion
    // werden Kapitel-Rows komplett ersetzt (DELETE/INSERT in
    // pipeline.ts), wodurch der Cache automatisch invalidiert.
    d.exec("ALTER TABLE chapters ADD COLUMN audio_text TEXT");
    d.exec("ALTER TABLE chapters ADD COLUMN audio_text_model TEXT");
  }
  if (!chapterCols.some((c) => c.name === "include_in_audio")) {
    // Pro-Kapitel-Toggle ob es ins Hörbuch geht. Default an für
    // content/summary, aus für alle anderen kinds — wird beim
    // Insert in pipeline.ts gesetzt. Bei alten Rows ohne Wert
    // bekommt das die kind-basierte Default-Logik beim Lesen.
    // 1 = include, 0 = exclude, NULL = use kind-default.
    d.exec("ALTER TABLE chapters ADD COLUMN include_in_audio INTEGER");
  }

  const docCols = d.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  if (!docCols.some((c) => c.name === "author")) {
    // Aus Docling-Metadaten extrahiert (PDF-Metadata-Feld). Wenn
    // die PDF keine Autor-Info hat, bleibt NULL — wir füllen das
    // nicht heuristisch (Fehlerquelle für ID3-Tags).
    d.exec("ALTER TABLE documents ADD COLUMN author TEXT");
  }
  if (!docCols.some((c) => c.name === "doc_title")) {
    // Echter Doc-Titel aus Docling (vs. `title` der vom Filename
    // kommt und vom User editiert sein kann). Wenn beide gesetzt,
    // gewinnt `title` für die UI; `doc_title` ist für ID3-Tags
    // und exakte Bibliografie.
    d.exec("ALTER TABLE documents ADD COLUMN doc_title TEXT");
  }
  if (!docCols.some((c) => c.name === "audio_intro_text")) {
    // Optionaler Intro-Text der vor dem ersten Kapitel ins Hörbuch
    // eingeführt wird ("Hörbuch: ..., Verfasst von ..., ..."). NULL
    // = kein Intro, Hörbuch beginnt direkt mit Kapitel 1. User
    // editiert das im Audiobook-Tab über die Intro-Box.
    d.exec("ALTER TABLE documents ADD COLUMN audio_intro_text TEXT");
  }

  // chunks-Tabelle für RAG. Pro Chunk ca. 800 Tokens Text + ein 768-
  // float32-Embedding (3 KB) von nomic-embed-text. Brute-Force-Cosine
  // über alle Chunks eines Dokuments ist in < 100 ms machbar bis in
  // die Zehntausender — wir brauchen keine Vector-DB solange.
  d.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      start_page INTEGER NOT NULL DEFAULT 0,
      end_page INTEGER NOT NULL DEFAULT 0,
      embedding BLOB,
      embedding_model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_chapter ON chunks(chapter_id);
  `);

  // Voice-Samples für Qwen3-TTS Voice-Clone. User lädt eine 3-10 s
  // Referenz-WAV/MP3 hoch, wir speichern die Datei im Data-Volume und
  // halten Metadaten in dieser Tabelle. Der feste Seed (Random gewürfelt
  // beim Upload) sorgt dafür, dass dieselbe Voice run-to-run identisch
  // klingt.
  d.exec(`
    CREATE TABLE IF NOT EXISTS voice_samples (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT 'female',
      language TEXT NOT NULL DEFAULT 'de',
      ref_path TEXT NOT NULL,
      ref_text TEXT,
      seed INTEGER NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Beim Start aufräumen: alle Dokumente, die noch `running` stehen,
  // sind Überbleibsel aus einem vorherigen App-Run (Container-Restart
  // während einer Docling-Extraktion — Task-ID war nur in-memory, ist
  // verloren). Auf `failed` setzen + Start-Zeit-Spalte clearen.
  const stuck = d
    .prepare(
      "UPDATE documents SET ocr_status = 'failed', extraction_started_at = NULL WHERE ocr_status IN ('running', 'pending')"
    )
    .run();
  if (stuck.changes > 0) {
    console.log(
      `[db] reset ${stuck.changes} stuck extraction(s) to 'failed' on startup`
    );
  }

  console.log("Database ready:", DB_PATH);
}
