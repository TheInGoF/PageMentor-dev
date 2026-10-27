// Vektorindex mit sqlite-vec: gleiche DB-Datei, kein eigener Dienst
// 300 000 Abschnitte × 1024 Dimensionen: ~0,75 s je Frage statt ~90 s beim Durchlauf in JS
import type { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { APP_DIR } from "../../paths";

const LIB = process.platform === "win32" ? "vec0.dll" : process.platform === "darwin" ? "vec0.dylib" : "vec0.so";

export const vecState: { available: boolean; error: string | null; path: string | null } = { available: false, error: null, path: null };

// Reihenfolge: Umgebungsvariable, neben der Exe, aus node_modules (Entwicklung)
function candidates(): string[] {
  const out: string[] = [];
  if (process.env.PM_SQLITE_VEC) out.push(process.env.PM_SQLITE_VEC);
  out.push(join(APP_DIR, LIB));
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    out.push(require("sqlite-vec").getLoadablePath());
  } catch {
    // in der Exe gibt es kein node_modules
  }
  return out;
}

export function loadVec(d: Database): boolean {
  let lastErr = "";
  for (const p of candidates()) {
    if (p !== process.env.PM_SQLITE_VEC && !existsSync(p)) continue;
    try {
      d.loadExtension(p);
      Object.assign(vecState, { available: true, error: null, path: p });
      return true;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  Object.assign(vecState, { available: false, error: lastErr || "vec0 nicht gefunden", path: null });
  return false;
}

function tableDim(d: Database): number | null {
  const row = d.prepare("SELECT sql FROM sqlite_master WHERE name = 'chunks_vec'").get() as { sql: string } | null;
  const m = row ? /float\[(\d+)\]/.exec(row.sql) : null;
  return m ? Number(m[1]) : null;
}

// Tabelle passend zur Dimension des Embedders; neues Modell = neuer Index
export function ensureVecTable(d: Database, dim: number): void {
  const have = tableDim(d);
  if (have === dim) return;
  if (have !== null) d.exec("DROP TABLE chunks_vec");
  d.exec(`CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[${dim}], module_id text, +document_id text)`);
}

export interface VecSync {
  added: number;
  removed: number;
  moved: number;
}

// Index an chunks angleichen: neue Vektoren rein, gelöschte raus, Modulwechsel nachziehen
export function syncVectors(d: Database): VecSync {
  const out = { added: 0, removed: 0, moved: 0 };
  if (!vecState.available) return out;
  const sample = d.prepare("SELECT length(embedding) AS n FROM chunks WHERE embedding IS NOT NULL LIMIT 1").get() as { n: number } | null;
  if (!sample) return out;
  ensureVecTable(d, sample.n / 4);
  d.transaction(() => {
    out.removed = d.prepare("DELETE FROM chunks_vec WHERE rowid NOT IN (SELECT rowid FROM chunks WHERE embedding IS NOT NULL)").run().changes;
    const missing = d
      .prepare(
        `SELECT c.rowid AS rid, c.embedding, c.document_id, doc.module_id FROM chunks c JOIN documents doc ON doc.id = c.document_id
          WHERE c.embedding IS NOT NULL AND length(c.embedding) = ? AND c.rowid NOT IN (SELECT rowid FROM chunks_vec)`
      )
      .all(sample.n) as Array<{ rid: number; embedding: Uint8Array; document_id: string; module_id: string | null }>;
    const ins = d.prepare("INSERT INTO chunks_vec (rowid, embedding, module_id, document_id) VALUES (?, ?, ?, ?)");
    for (const r of missing) ins.run(r.rid, r.embedding, r.module_id ?? "", r.document_id);
    out.added = missing.length;
    const moved = d
      .prepare(
        `SELECT v.rowid AS rid, COALESCE(doc.module_id, '') AS module_id FROM chunks_vec v JOIN documents doc ON doc.id = v.document_id
          WHERE v.module_id != COALESCE(doc.module_id, '')`
      )
      .all() as Array<{ rid: number; module_id: string }>;
    const upd = d.prepare("UPDATE chunks_vec SET module_id = ? WHERE rowid = ?");
    for (const r of moved) upd.run(r.module_id, r.rid);
    out.moved = moved.length;
  })();
  return out;
}

export function vecSearch(d: Database, q: Float32Array, k: number, moduleId: string | null): Array<{ rowid: number; distance: number }> {
  if (!vecState.available || tableDim(d) !== q.length) return [];
  const blob = new Uint8Array(q.buffer, q.byteOffset, q.byteLength);
  const sql = `SELECT rowid, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ?${moduleId ? " AND module_id = ?" : ""}`;
  return d.prepare(sql).all(...(moduleId ? [blob, k, moduleId] : [blob, k])) as Array<{ rowid: number; distance: number }>;
}
