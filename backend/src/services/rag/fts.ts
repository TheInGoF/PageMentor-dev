// Volltext über alle Abschnitte mit SQLite FTS5 (BM25), unabhängig von Meilisearch
import type { Database } from "bun:sqlite";

export function ensureFts(d: Database): void {
  const exists = d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'chunks_fts'").get();
  if (exists) return;
  d.exec(`
    CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER chunks_fts_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER chunks_fts_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER chunks_fts_au AFTER UPDATE OF text ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild');
  `);
}

// Freitext in eine sichere FTS-Abfrage: Wörter ab 3 Zeichen, mit ODER, Präfixsuche
export function ftsQuery(question: string): string | null {
  const words = (question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 24);
  return words.length ? words.map((w) => `"${w}"*`).join(" OR ") : null;
}

export function ftsSearch(d: Database, question: string, k: number, moduleId: string | null): Array<{ rowid: number; rank: number }> {
  const q = ftsQuery(question);
  if (!q) return [];
  const sql = `SELECT f.rowid, f.rank FROM chunks_fts f
    ${moduleId ? "JOIN chunks c ON c.rowid = f.rowid JOIN documents doc ON doc.id = c.document_id" : ""}
    WHERE chunks_fts MATCH ?${moduleId ? " AND doc.module_id = ?" : ""} ORDER BY f.rank LIMIT ?`;
  return d.prepare(sql).all(...(moduleId ? [q, moduleId, k] : [q, k])) as Array<{ rowid: number; rank: number }>;
}
