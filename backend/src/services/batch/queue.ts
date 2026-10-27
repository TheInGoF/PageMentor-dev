// Stapel-Import: Ordner einlesen, PDFs nacheinander verarbeiten, fortsetzbar, auf Wunsch nur nachts
import { randomUUID } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { basename, extname, join } from "path";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { emitLog } from "../../log/logger";
import { profileValue, setProfileValue } from "../../study/progress";

export interface EnqueueOptions {
  docType?: string;
  moduleId?: string | null;
  // Ordner mit vorhandenen Docling-Markdowns (z. B. 10_temp/md), Zuordnung über den Dateinamen
  mdFolder?: string | null;
}

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (extname(e.name).toLowerCase() === ext) out.push(p);
  }
  return out;
}

const stem = (p: string) => basename(p, extname(p)).toLowerCase();

export function enqueueFolder(folder: string, opts: EnqueueOptions = {}): { added: number; skipped: number; withMarkdown: number } {
  if (!existsSync(folder)) throw new Error(`Ordner nicht gefunden: ${folder}`);
  const pdfs = walk(folder, ".pdf");
  const mdIndex = new Map<string, string>();
  for (const dir of [folder, opts.mdFolder].filter((x): x is string => !!x && existsSync(x))) for (const md of walk(dir, ".md")) mdIndex.set(stem(md), md);
  // Schon in der Bibliothek: gleicher Dateiname und gleiche Größe
  const known = new Set((db().prepare("SELECT filename, size_bytes FROM documents").all() as Array<{ filename: string; size_bytes: number }>).map((r) => `${r.filename.toLowerCase()}|${r.size_bytes}`));
  const ins = db().prepare("INSERT OR IGNORE INTO import_queue (path, md_path, size_bytes, doc_type, module_id) VALUES (?, ?, ?, ?, ?)");
  let added = 0;
  let skipped = 0;
  let withMarkdown = 0;
  db().transaction(() => {
    for (const p of pdfs) {
      const size = statSync(p).size;
      const md = mdIndex.get(stem(p)) ?? null;
      if (known.has(`${basename(p).toLowerCase()}|${size}`) || !ins.run(p, md, size, opts.docType ?? "studienheft", opts.moduleId ?? null).changes) {
        skipped++;
        continue;
      }
      added++;
      if (md) withMarkdown++;
    }
  })();
  return { added, skipped, withMarkdown };
}

export interface QueueStatus {
  waiting: number;
  running: number;
  done: number;
  failed: number;
  current: string | null;
  avgSeconds: number | null;
  etaSeconds: number | null;
  paused: boolean;
  nightOnly: boolean;
  failures: Array<{ id: number; path: string; error: string | null }>;
}

export function queueStatus(): QueueStatus {
  const c = (s: string) => (db().prepare("SELECT COUNT(*) AS n FROM import_queue WHERE status = ?").get(s) as { n: number }).n;
  const avg = (db().prepare("SELECT AVG(seconds) AS a FROM (SELECT seconds FROM import_queue WHERE status = 'fertig' AND seconds IS NOT NULL ORDER BY finished_at DESC LIMIT 20)").get() as { a: number | null }).a;
  const current = (db().prepare("SELECT path FROM import_queue WHERE status = 'läuft' LIMIT 1").get() as { path: string } | null)?.path ?? null;
  const waiting = c("wartet");
  return {
    waiting,
    running: c("läuft"),
    done: c("fertig"),
    failed: c("fehler"),
    current: current ? basename(current) : null,
    avgSeconds: avg ? Math.round(avg) : null,
    etaSeconds: avg ? Math.round(avg * (waiting + (current ? 0.5 : 0))) : null,
    paused: profileValue("batch_paused") === "1",
    nightOnly: profileValue("batch_night") === "1",
    failures: db().prepare("SELECT id, path, error FROM import_queue WHERE status = 'fehler' ORDER BY id LIMIT 50").all() as QueueStatus["failures"],
  };
}

export function setQueueFlags(flags: { paused?: boolean; nightOnly?: boolean }): void {
  if (flags.paused !== undefined) setProfileValue("batch_paused", flags.paused ? "1" : null);
  if (flags.nightOnly !== undefined) setProfileValue("batch_night", flags.nightOnly ? "1" : null);
}

export function retryFailed(): number {
  return db().prepare("UPDATE import_queue SET status = 'wartet', error = NULL WHERE status = 'fehler'").run().changes;
}

export function clearFinished(): number {
  return db().prepare("DELETE FROM import_queue WHERE status = 'fertig'").run().changes;
}

// Nachtbetrieb: 22 bis 6 Uhr, dann gehört die GPU dem Import
export function isNight(d = new Date()): boolean {
  return d.getHours() >= 22 || d.getHours() < 6;
}

// PDF wie beim Hochladen in den Datenordner kopieren und als Dokument anlegen
export function createDocumentFromFile(path: string, docType: string, moduleId: string | null, mdPath: string | null, dataDir = DATA_DIR): string {
  const id = randomUUID();
  const name = basename(path).replace(/[\x00-\x1f"\\]/g, "");
  const dir = join(dataDir, "uploads", id);
  mkdirSync(dir, { recursive: true });
  copyFileSync(path, join(dir, name));
  db()
    .prepare(
      `INSERT INTO documents (id, title, filename, stored_path, mime_type, size_bytes, language, type, module_id, ocr_status, source_md)
       VALUES (?, ?, ?, ?, 'application/pdf', ?, 'de', ?, ?, 'awaiting-extraction', ?)`
    )
    .run(id, name.replace(/\.pdf$/i, ""), name, join("uploads", id, name), statSync(path).size, docType, moduleId, mdPath);
  return id;
}

export type Processor = (docId: string) => Promise<void>;

// Ein Eintrag; Rückgabe false, wenn nichts zu tun war
export async function processNext(process: Processor, dataDir = DATA_DIR): Promise<boolean> {
  const item = db().prepare("SELECT * FROM import_queue WHERE status = 'wartet' ORDER BY id LIMIT 1").get() as
    | { id: number; path: string; md_path: string | null; doc_type: string; module_id: string | null }
    | null;
  if (!item) return false;
  db().prepare("UPDATE import_queue SET status = 'läuft' WHERE id = ?").run(item.id);
  const t0 = Date.now();
  try {
    if (!existsSync(item.path)) throw new Error("Datei nicht mehr vorhanden");
    const docId = createDocumentFromFile(item.path, item.doc_type, item.module_id, item.md_path, dataDir);
    db().prepare("UPDATE import_queue SET document_id = ? WHERE id = ?").run(docId, item.id);
    await process(docId);
    const status = (db().prepare("SELECT ocr_status FROM documents WHERE id = ?").get(docId) as { ocr_status: string } | null)?.ocr_status;
    if (status !== "done") throw new Error(`Verarbeitung endete mit Status ${status ?? "?"}`);
    db().prepare("UPDATE import_queue SET status = 'fertig', seconds = ?, finished_at = datetime('now') WHERE id = ?").run((Date.now() - t0) / 1000, item.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db().prepare("UPDATE import_queue SET status = 'fehler', error = ?, finished_at = datetime('now') WHERE id = ?").run(msg, item.id);
    emitLog("warn", "batch", `Stapel-Import: ${basename(item.path)} fehlgeschlagen: ${msg}`);
  }
  return true;
}

let running = false;

// Läuft im Hintergrund, bis die Schlange leer ist; Pause und Nachtbetrieb werden zwischen Einträgen geprüft
export async function runQueue(process: Processor, waitMs = 5 * 60_000, dataDir = DATA_DIR): Promise<void> {
  if (running) return;
  running = true;
  // Nach einem Absturz: halb fertige Einträge neu starten
  db().prepare("UPDATE import_queue SET status = 'wartet' WHERE status = 'läuft'").run();
  try {
    for (;;) {
      const s = queueStatus();
      if (!s.waiting) break;
      if (s.paused || (s.nightOnly && !isNight())) {
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      await processNext(process, dataDir);
    }
    emitLog("info", "batch", "Stapel-Import: Warteschlange abgearbeitet");
  } finally {
    running = false;
  }
}
