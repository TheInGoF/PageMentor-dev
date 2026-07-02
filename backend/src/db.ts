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
    // Epoch-ms. Set at extraction start and reset to NULL on end
    // (done / failed). Lets the frontend keep showing the correct
    // runtime after a reload instead of restarting the timer at 0.
    d.exec("ALTER TABLE documents ADD COLUMN extraction_started_at INTEGER");
  }

  const moduleCols = d.prepare("PRAGMA table_info(modules)").all() as Array<{ name: string }>;
  if (!moduleCols.some((c) => c.name === "completed")) {
    // Completed modules collapse in the library and sort below the
    // active ones.
    d.exec("ALTER TABLE modules ADD COLUMN completed INTEGER NOT NULL DEFAULT 0");
  }

  const summaryCols = d.prepare("PRAGMA table_info(summaries)").all() as Array<{ name: string }>;
  if (!summaryCols.some((c) => c.name === "generation_ms")) {
    d.exec("ALTER TABLE summaries ADD COLUMN generation_ms INTEGER NOT NULL DEFAULT 0");
  }

  const chapterCols = d.prepare("PRAGMA table_info(chapters)").all() as Array<{ name: string }>;
  if (!chapterCols.some((c) => c.name === "kind")) {
    // Section kind — drives which features use it. Default
    // "content" for old rows; newly extracted docs get the
    // classification directly from the Docling parser.
    d.exec("ALTER TABLE chapters ADD COLUMN kind TEXT NOT NULL DEFAULT 'content'");
  }
  if (!chapterCols.some((c) => c.name === "audio_text")) {
    // LLM-preprocessed chapter text, optimized for TTS:
    // abbreviations expanded, formulas verbalized, citations
    // stripped, etc. NULL = not yet generated; on re-extraction
    // chapter rows are fully replaced (DELETE/INSERT in
    // pipeline.ts), which invalidates the cache automatically.
    d.exec("ALTER TABLE chapters ADD COLUMN audio_text TEXT");
    d.exec("ALTER TABLE chapters ADD COLUMN audio_text_model TEXT");
  }
  if (!chapterCols.some((c) => c.name === "include_in_audio")) {
    // Per-chapter toggle for whether it goes into the audiobook.
    // Default on for content/summary, off for all other kinds —
    // set on insert in pipeline.ts. Old rows without a value get
    // the kind-based default logic on read.
    // 1 = include, 0 = exclude, NULL = use kind-default.
    d.exec("ALTER TABLE chapters ADD COLUMN include_in_audio INTEGER");
  }
  if (!chapterCols.some((c) => c.name === "card_text")) {
    // LLM-preprocessed chapter text, optimized for card generation.
    // Two distinct usage modes encoded in `card_text_type`:
    //   "qa_pairs": chapter is an exam / exercise sheet. card_text
    //               is a JSON-stringified array of {question, answer}
    //               objects that the Cards-Generator imports
    //               directly without a second LLM round-trip.
    //   "content":  chapter is regular study material. card_text is
    //               the same prose with PDF-mangled formulas
    //               reconstructed in LaTeX ($P(x_i) = 0,5$ etc.) so
    //               the AI-card-gen builds clean cards.
    // NULL = not yet preprocessed; AI-card-gen falls back to the raw
    //        `text` column with the same garble-handling prompt as
    //        before.
    d.exec("ALTER TABLE chapters ADD COLUMN card_text TEXT");
    d.exec("ALTER TABLE chapters ADD COLUMN card_text_model TEXT");
    d.exec("ALTER TABLE chapters ADD COLUMN card_text_type TEXT");
  }

  const docCols = d.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  if (!docCols.some((c) => c.name === "author")) {
    // Extracted from Docling metadata (PDF metadata field). If the
    // PDF has no author info, stays NULL — we don't fill this
    // heuristically (source of errors for ID3 tags).
    d.exec("ALTER TABLE documents ADD COLUMN author TEXT");
  }
  if (!docCols.some((c) => c.name === "doc_title")) {
    // Real doc title from Docling (vs. `title` which comes from the
    // filename and may have been edited by the user). When both are
    // set, `title` wins for the UI; `doc_title` is for ID3 tags
    // and exact bibliography.
    d.exec("ALTER TABLE documents ADD COLUMN doc_title TEXT");
  }
  if (!docCols.some((c) => c.name === "short_code")) {
    // User shortcode for the library — e.g. "SE12k" for course
    // booklets or "1", "2", "3" for series volumes. Feeds into the
    // M4B filename + metadata (iTunes field `grouping`).
    d.exec("ALTER TABLE documents ADD COLUMN short_code TEXT");
  }
  if (!docCols.some((c) => c.name === "series_sequence")) {
    // Position in der Modul-Serie (z.B. "1" fuer das erste Heft eines
    // Studiengangs). Wird beim Audiobookshelf-Upload als series.sequence
    // mitgesendet UND als track + movement_index in den M4B-Tag
    // geschrieben (ueberlebt ABS-Library-Rescan). NULL = keine
    // Sequenz-Info, Audiobookshelf zeigt Buch ohne Reihenfolge in der Serie.
    d.exec("ALTER TABLE documents ADD COLUMN series_sequence TEXT");
  }
  if (!docCols.some((c) => c.name === "audio_intro_text")) {
    // Optional intro text spoken before the first chapter in the
    // audiobook ("Audiobook: ..., Written by ..., ..."). NULL =
    // no intro, audiobook starts directly with chapter 1. User
    // edits this in the Audiobook tab via the intro box.
    d.exec("ALTER TABLE documents ADD COLUMN audio_intro_text TEXT");
  }
  if (!docCols.some((c) => c.name === "force_ocr")) {
    // Force full-page OCR on extraction (re-runs RapidOCR over the
    // rasterised page even when the PDF has extractable text). Needed
    // for PDFs where the font's CMap is broken so /gNN glyph names
    // leak through as garbage tokens ("Quelle /g94 /g96 i 1 2 n ...").
    // Default 0 (off) because force-OCR roughly doubles extraction
    // time and most PDFs don't need it.
    d.exec("ALTER TABLE documents ADD COLUMN force_ocr INTEGER NOT NULL DEFAULT 0");
  }
  if (!docCols.some((c) => c.name === "audio_intro_text_tts")) {
    // Gemma-cleaned TTS variant of audio_intro_text. User stores the
    // readable form ("Qwen3-TTS", "PageMentor") in audio_intro_text;
    // the preprocessor turns model names and brand names into Qwen-
    // pronounceable phonetics ("Kwenn drei T T S", "Peigementor") and
    // caches the result here. NULL = not yet preprocessed; the next
    // generate call falls back to the raw intro text. Cleared when
    // audio_intro_text changes.
    d.exec("ALTER TABLE documents ADD COLUMN audio_intro_text_tts TEXT");
    d.exec("ALTER TABLE documents ADD COLUMN audio_intro_text_tts_model TEXT");
  }

  // chunks table for RAG. Per chunk roughly 800 tokens of text + a
  // 768-float32 embedding (3 KB) from nomic-embed-text. Brute-force
  // cosine over all chunks of a document runs in < 100 ms up into
  // the tens of thousands — we don't need a vector DB for that long.
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

  // Tutor chat — module-scoped Q&A with the learning materials. Each
  // session is bound to one module (or NULL for "all modules"); each
  // message either user-authored (plain text) or assistant-generated
  // (JSON with the three sections + source list, stored as TEXT for
  // simplicity — the frontend parses it back).
  d.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session
      ON chat_messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated
      ON chat_sessions(updated_at DESC);
  `);

  // Voice samples for Qwen3-TTS voice clone. User uploads a 3-10 s
  // reference WAV/MP3, we store the file in the data volume and keep
  // metadata in this table. The fixed seed (rolled at upload) ensures
  // that the same voice sounds identical run-to-run.
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

  // Benchmark columns for ETA calculation. After every successful
  // chunk the qwen engine updates ms_per_char via exponential moving
  // average (alpha=0.2). The frontend ETA uses this as the starting
  // value before the running run produces its own measurements.
  const vsCols = d
    .prepare("PRAGMA table_info(voice_samples)")
    .all() as Array<{ name: string }>;
  if (!vsCols.some((c) => c.name === "ms_per_char")) {
    d.exec("ALTER TABLE voice_samples ADD COLUMN ms_per_char REAL");
  }
  if (!vsCols.some((c) => c.name === "samples_count")) {
    d.exec(
      "ALTER TABLE voice_samples ADD COLUMN samples_count INTEGER NOT NULL DEFAULT 0"
    );
  }
  // show_in_audiobook — gates which voices appear in the audiobook
  // tab's voice picker. With ~30 candidates (9 presets + N user
  // samples + M design voices) the dropdown becomes unreadable.
  // Default 1 = visible (existing voices stay visible after upgrade).
  if (!vsCols.some((c) => c.name === "show_in_audiobook")) {
    d.exec(
      "ALTER TABLE voice_samples ADD COLUMN show_in_audiobook INTEGER NOT NULL DEFAULT 1"
    );
  }
  // instruct — optional per-voice speaking-style prompt forwarded to
  // generate_voice_clone. Without it, the clone path drifts in tempo
  // between chunks. Examples: "Calm narrator, steady pace",
  // "Slow and clear audiobook narration".
  if (!vsCols.some((c) => c.name === "instruct")) {
    d.exec("ALTER TABLE voice_samples ADD COLUMN instruct TEXT");
  }

  // voice_designs — text-described voices for the Qwen3-TTS
  // VoiceDesign model. Instead of a reference audio file, this holds
  // a free-text prompt ("Warm German narrator, early 40s, …").
  // The seed freezes the voice — same seed + same description should
  // empirically reproduce the same voice.
  d.exec(`
    CREATE TABLE IF NOT EXISTS voice_designs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT 'female',
      language TEXT NOT NULL DEFAULT 'de',
      description TEXT NOT NULL,
      seed INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ms_per_char REAL,
      samples_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Reference audio per design. Qwen3-TTS VoiceDesign doesn't return
  // seed-stable output per generate call — it's not built for that.
  // The official Qwen README shows the "VoiceDesign → Clone" pattern:
  // generate a reference WAV via VoiceDesign once, then for every
  // further synthesis use the base clone model with that reference
  // (clone IS seed-stable). Columns are filled lazily: on create
  // of a new design voice, or on first audiobook use of an old
  // design voice without a stored reference.
  const vdCols = d
    .prepare("PRAGMA table_info(voice_designs)")
    .all() as Array<{ name: string }>;
  if (!vdCols.some((c) => c.name === "ref_path")) {
    d.exec("ALTER TABLE voice_designs ADD COLUMN ref_path TEXT");
  }
  if (!vdCols.some((c) => c.name === "ref_text")) {
    d.exec("ALTER TABLE voice_designs ADD COLUMN ref_text TEXT");
  }
  if (!vdCols.some((c) => c.name === "show_in_audiobook")) {
    d.exec(
      "ALTER TABLE voice_designs ADD COLUMN show_in_audiobook INTEGER NOT NULL DEFAULT 1"
    );
  }

  // Cleanup at startup: any documents still in `running` are leftovers
  // from a previous app run (container restart during a Docling
  // extraction — task ID was only in-memory and is lost). Set to
  // `failed` + clear the start-time column.
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
