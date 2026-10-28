// Stapel-Import: Ordner einlesen, PDFs nacheinander verarbeiten, fortsetzbar, auf Wunsch nur nachts
import { randomUUID } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from "fs";
import { basename, extname, join, relative } from "path";
import { db } from "../../db";
import { DATA_DIR, IMPORT_DIR } from "../../paths";
import { extractPdf } from "../pdf";
import { backfillSha1, describeDuplicate, documentBySha1, fileSha1, findTextDuplicate, textMinhash } from "./dedupe";
import { emitLog } from "../../log/logger";
import { profileValue, setProfileValue } from "../../study/progress";

export interface EnqueueOptions {
  docType?: string;
  moduleId?: string | null;
  // Ordner mit vorhandenen Docling-Markdowns (z. B. 10_temp/md), Zuordnung über den Dateinamen
  mdFolder?: string | null;
}

// Ablageordner im Import-Ordner werden nicht wieder eingelesen
export const IMPORT_DONE = "Erledigt";
export const IMPORT_DUPLICATES = "Dubletten";

function walk(dir: string, ext: string, out: string[] = [], skip: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip.includes(e.name)) walk(p, ext, out, skip);
    }
    else if (extname(e.name).toLowerCase() === ext) out.push(p);
  }
  return out;
}

const stem = (p: string) => basename(p, extname(p)).toLowerCase();

export interface EnqueueResult {
  added: number;
  skipped: number;
  withMarkdown: number;
  // Gleiche Datei schon in der Bibliothek, in der Warteschlange oder doppelt im Ordner
  duplicates: Array<{ name: string; reason: string }>;
}

// Stufe 1 der Dublettenprüfung schon beim Einreihen: Fingerabdruck der Datei, kostet nur Lesen
// minAgeMs: jüngere Dateien auslassen, sie werden womöglich noch kopiert (Import-Ordner)
export async function enqueueFolder(folder: string, opts: EnqueueOptions = {}, dataDir = DATA_DIR, minAgeMs = 0): Promise<EnqueueResult> {
  if (!existsSync(folder)) throw new Error(`Ordner nicht gefunden: ${folder}`);
  const inImport = isInside(folder, importDir(dataDir));
  const pdfs = walk(folder, ".pdf", [], inImport ? [IMPORT_DONE, IMPORT_DUPLICATES] : []);
  const mdIndex = new Map<string, string>();
  for (const dir of [folder, opts.mdFolder].filter((x): x is string => !!x && existsSync(x))) for (const md of walk(dir, ".md")) mdIndex.set(stem(md), md);
  await backfillSha1();
  const queued = new Map((db().prepare("SELECT sha1, path FROM import_queue WHERE sha1 IS NOT NULL AND status != 'dublette'").all() as Array<{ sha1: string; path: string }>).map((r) => [r.sha1, r.path]));
  // Schon eingereiht mit gleicher Größe: nicht bei jedem Durchlauf neu durchrechnen
  const sizeByPath = new Map((db().prepare("SELECT path, size_bytes FROM import_queue WHERE status != 'dublette'").all() as Array<{ path: string; size_bytes: number }>).map((r) => [r.path, r.size_bytes]));
  const ins = db().prepare("INSERT OR IGNORE INTO import_queue (path, md_path, size_bytes, doc_type, module_id, sha1) VALUES (?, ?, ?, ?, ?, ?)");
  const res: EnqueueResult = { added: 0, skipped: 0, withMarkdown: 0, duplicates: [] };
  for (const p of pdfs) {
    const st = statSync(p);
    if (sizeByPath.get(p) === st.size) {
      res.skipped++;
      continue;
    }
    // Windows behält beim Kopieren die Änderungszeit, darum auch Erstellzeit und ctime ansehen
    if (minAgeMs && Date.now() - Math.max(st.mtimeMs, st.ctimeMs, st.birthtimeMs) < minAgeMs) continue;
    let sha1: string;
    try {
      sha1 = await fileSha1(p);
    } catch {
      // Gesperrt, weil noch kopiert wird: beim nächsten Durchlauf
      continue;
    }
    const inLibrary = documentBySha1(sha1);
    const queuedAs = queued.get(sha1);
    if (queuedAs === p) {
      res.skipped++;
      continue;
    }
    if (inLibrary || queuedAs) {
      const reason = inLibrary ? describeDuplicate(inLibrary) : `Dublette: gleiche Datei wie ${basename(queuedAs!)} (schon eingereiht)`;
      res.duplicates.push({ name: basename(p), reason });
      if (inImport) moveFromImport(p, IMPORT_DUPLICATES, dataDir);
      continue;
    }
    const md = mdIndex.get(stem(p)) ?? null;
    if (!ins.run(p, md, st.size, opts.docType ?? "studienheft", opts.moduleId ?? null, sha1).changes) {
      res.skipped++;
      continue;
    }
    queued.set(sha1, p);
    res.added++;
    if (md) res.withMarkdown++;
  }
  if (res.duplicates.length) emitLog("info", "batch", `Stapel-Import: ${res.duplicates.length} Dubletten übersprungen`, { ctx: { dateien: res.duplicates.map((d) => d.name).join(", ") } });
  return res;
}

const importDir = (dataDir: string) => (dataDir === DATA_DIR ? IMPORT_DIR : join(dataDir, "Import"));

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !/^[a-zA-Z]:/.test(rel) && !rel.startsWith("/"));
}

// Verarbeitete Datei aus dem Import-Ordner wegräumen; Unterordner bleiben erhalten
export function moveFromImport(path: string, sub: string, dataDir = DATA_DIR): string | null {
  const root = importDir(dataDir);
  if (!existsSync(path) || !isInside(path, root)) return null;
  const rel = relative(root, path);
  let target = join(root, sub, rel);
  mkdirSync(join(target, ".."), { recursive: true });
  for (let i = 2; existsSync(target); i++) target = join(root, sub, rel.replace(/(\.pdf)?$/i, ` (${i})$1`));
  try {
    renameSync(path, target);
  } catch {
    copyFileSync(path, target);
    unlinkSync(path);
  }
  return target;
}

// Dateien im Import-Ordner erst einreihen, wenn sie eine Minute in Ruhe liegen
export const IMPORT_MIN_AGE_MS = 60_000;

let scanning: Promise<EnqueueResult | null> | null = null;

// Import-Ordner anlegen und neue PDFs einreihen; läuft beim Start und regelmäßig.
// Ein laufender Durchlauf wird geteilt, damit Zeitgeber und „Jetzt einlesen“ nicht doppelt einreihen
export function scanImportFolder(opts: EnqueueOptions = {}, dataDir = DATA_DIR, minAgeMs = IMPORT_MIN_AGE_MS): Promise<EnqueueResult | null> {
  scanning ??= (async () => {
    const dir = importDir(dataDir);
    mkdirSync(dir, { recursive: true });
    if (!walk(dir, ".pdf", [], [IMPORT_DONE, IMPORT_DUPLICATES]).length) return null;
    return enqueueFolder(dir, opts, dataDir, minAgeMs);
  })().finally(() => {
    scanning = null;
  });
  return scanning;
}

export interface QueueStatus {
  waiting: number;
  running: number;
  done: number;
  failed: number;
  duplicates: number;
  current: string | null;
  avgSeconds: number | null;
  etaSeconds: number | null;
  paused: boolean;
  nightOnly: boolean;
  failures: Array<{ id: number; path: string; error: string | null }>;
  duplicateItems: Array<{ id: number; path: string; error: string | null }>;
}

export function queueStatus(): QueueStatus {
  const c = (s: string) => (db().prepare("SELECT COUNT(*) AS n FROM import_queue WHERE status = ?").get(s) as { n: number }).n;
  const avg = (db().prepare("SELECT AVG(seconds) AS a FROM (SELECT seconds FROM import_queue WHERE status = 'fertig' AND seconds IS NOT NULL ORDER BY finished_at DESC LIMIT 20)").get() as { a: number | null }).a;
  const current = (db().prepare("SELECT path FROM import_queue WHERE status = 'läuft' LIMIT 1").get() as { path: string } | null)?.path ?? null;
  const waiting = c("wartet");
  return {
    duplicates: c("dublette"),
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
    duplicateItems: db().prepare("SELECT id, path, error FROM import_queue WHERE status = 'dublette' ORDER BY id DESC LIMIT 50").all() as QueueStatus["duplicateItems"],
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
  return db().prepare("DELETE FROM import_queue WHERE status IN ('fertig', 'dublette')").run().changes;
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

// Stufe 2 der Dublettenprüfung vor Docling: Textebene lesen (wenige Sekunden) und mit der Bibliothek vergleichen
async function textLayerHash(path: string): Promise<number[] | null> {
  try {
    return textMinhash((await extractPdf(path)).pages.join("\n"));
  } catch {
    return null;
  }
}

// Ein Eintrag; Rückgabe false, wenn nichts zu tun war
export async function processNext(process: Processor, dataDir = DATA_DIR): Promise<boolean> {
  const item = db().prepare("SELECT * FROM import_queue WHERE status = 'wartet' ORDER BY id LIMIT 1").get() as
    | { id: number; path: string; md_path: string | null; doc_type: string; module_id: string | null; sha1: string | null; document_id: string | null }
    | null;
  if (!item) return false;
  db().prepare("UPDATE import_queue SET status = 'läuft' WHERE id = ?").run(item.id);
  const t0 = Date.now();
  const markDuplicate = (reason: string) => {
    db().prepare("UPDATE import_queue SET status = 'dublette', error = ?, finished_at = datetime('now') WHERE id = ?").run(reason, item.id);
    moveFromImport(item.path, IMPORT_DUPLICATES, dataDir);
    emitLog("info", "batch", `Stapel-Import: ${basename(item.path)} übersprungen. ${reason}`);
  };
  try {
    if (!existsSync(item.path)) throw new Error("Datei nicht mehr vorhanden");
    // Neuer Versuch nach Fehler: das Dokument aus dem ersten Lauf weiterverwenden, es ist keine Dublette
    const retry = item.document_id && db().prepare("SELECT 1 FROM documents WHERE id = ?").get(item.document_id) ? item.document_id : null;
    let docId: string;
    if (retry) {
      docId = retry;
    } else {
      const sha1 = item.sha1 ?? (await fileSha1(item.path));
      const sameFile = documentBySha1(sha1);
      if (sameFile) {
        markDuplicate(describeDuplicate(sameFile));
        return true;
      }
      const hash = await textLayerHash(item.path);
      const sameText = hash ? findTextDuplicate(hash) : null;
      if (sameText) {
        markDuplicate(describeDuplicate(sameText));
        return true;
      }
      docId = createDocumentFromFile(item.path, item.doc_type, item.module_id, item.md_path, dataDir);
      db().prepare("UPDATE documents SET file_sha1 = ?, text_minhash = ? WHERE id = ?").run(sha1, hash ? JSON.stringify(hash) : null, docId);
      db().prepare("UPDATE import_queue SET document_id = ? WHERE id = ?").run(docId, item.id);
    }
    await process(docId);
    // Scan ohne Textebene: die Pipeline vergleicht nach Docling und verwirft die Dublette vor Kapiteln und KI
    const doc = db().prepare("SELECT ocr_status, duplicate_of FROM documents WHERE id = ?").get(docId) as { ocr_status: string; duplicate_of: string | null } | null;
    if (doc?.ocr_status === "duplicate") {
      const orig = db().prepare("SELECT id, title FROM documents WHERE id = ?").get(doc.duplicate_of) as { id: string; title: string } | null;
      removeDocumentFiles(docId, dataDir);
      db().prepare("DELETE FROM documents WHERE id = ?").run(docId);
      db().prepare("UPDATE import_queue SET document_id = NULL WHERE id = ?").run(item.id);
      markDuplicate(orig ? `Dublette: Inhalt gleich wie „${orig.title}“ (nach Texterkennung)` : "Dublette (nach Texterkennung)");
      return true;
    }
    if (doc?.ocr_status !== "done") throw new Error(`Verarbeitung endete mit Status ${doc?.ocr_status ?? "?"}`);
    db().prepare("UPDATE import_queue SET status = 'fertig', seconds = ?, finished_at = datetime('now') WHERE id = ?").run((Date.now() - t0) / 1000, item.id);
    moveFromImport(item.path, IMPORT_DONE, dataDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db().prepare("UPDATE import_queue SET status = 'fehler', error = ?, finished_at = datetime('now') WHERE id = ?").run(msg, item.id);
    emitLog("warn", "batch", `Stapel-Import: ${basename(item.path)} fehlgeschlagen: ${msg}`);
  }
  return true;
}

function removeDocumentFiles(docId: string, dataDir: string): void {
  for (const sub of ["uploads", "audio", "covers"]) {
    const p = join(dataDir, sub, docId);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
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
