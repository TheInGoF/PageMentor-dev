// Aufräumen: Hörbuch-Dateien, die PageMentor selbst erzeugt hat und nicht mehr braucht. Gelöscht wird nur, was sich
// eindeutig zuordnen lässt; alles andere bleibt. Läuft nach dem Start, alle 6 Stunden und von Hand, aber nie, solange
// ein Hörbuch oder Lernhörbuch läuft (dessen Zwischendateien sind dann in Benutzung).
//   audio/<heft>/…          Hefte, die es nicht mehr gibt; Kapitel-MP3s ohne Eintrag (Neunummerierung, alte Titel);
//                           Zwischenordner .tmp-<kapitel> von fertigen oder gelöschten Kapiteln, sonst nach 7 Tagen
//   audio/<heft>/learn/…    Stückordner fertiger Einheiten, Einheiten über die aktuelle Zahl hinaus
//   audio/compare/…         Stimmvergleiche gelöschter Hefte oder älter als 14 Tage
//   covers/                 Cover gelöschter Hefte, ältere Fassungen derselben Vorlage, Seiten außer der gewählten
//   Hörbücher-Ordner        Kopien, die PageMentor abgelegt hat, unter einem Namen, der nicht mehr gilt
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { db } from "../db";
import { AUDIOBOOK_EXPORT_DIR, DATA_DIR, fromDataPath } from "../paths";
import { emitLog } from "../log/logger";
import { anyGenerating } from "./audiobook";
import { learnBusy } from "./learnbook/run";
import { run } from "../tts/ffmpeg/run";

const DAY = 24 * 3600_000;
const INTERVAL_MS = 6 * 3600_000;
const REGISTRY = () => join(DATA_DIR, "exported-books.json");

export interface CleanupResult {
  files: number;
  bytes: number;
  skipped?: string;
}

// ----- Ablage der Kopien im Hörbücher-Ordner: Name → Heft und Art, damit nur eigene Kopien gelöscht werden -----
type Registry = Record<string, { docId: string; kind: "original" | "subject" | "language" }>;

function readRegistry(): Registry {
  try {
    return JSON.parse(readFileSync(REGISTRY(), "utf8")) as Registry;
  } catch {
    return {};
  }
}

export function registerExport(path: string, docId: string, kind: "original" | "subject" | "language"): void {
  try {
    const reg = readRegistry();
    reg[resolve(path)] = { docId, kind };
    writeFileSync(REGISTRY(), JSON.stringify(reg, null, 1));
  } catch {
    // Aufräumen ist Beiwerk
  }
}

// Kopie im Hörbücher-Ordner gezielt entfernen (Hörbuch gelöscht)
export function removeExport(path: string): void {
  try {
    rmSync(path, { force: true });
    const reg = readRegistry();
    if (reg[resolve(path)]) {
      delete reg[resolve(path)];
      writeFileSync(REGISTRY(), JSON.stringify(reg, null, 1));
    }
  } catch {
    // nichts zu tun
  }
}

// ----- Helfer -----
function sizeOf(path: string): number {
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return st.size;
    return readdirSync(path).reduce((a, n) => a + sizeOf(join(path, n)), 0);
  } catch {
    return 0;
  }
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function age(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

class Sweep {
  files = 0;
  bytes = 0;
  constructor(readonly dry: boolean) {}
  remove(path: string, why: string): void {
    if (!existsSync(path)) return;
    const size = sizeOf(path);
    if (!this.dry) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch (err) {
        emitLog("warn", "cleanup", `Nicht gelöscht: ${path}`, { err });
        return;
      }
    }
    this.files++;
    this.bytes += size;
    if (process.env.PM_CLEANUP_VERBOSE === "1") console.log(`[cleanup] ${this.dry ? "würde löschen" : "gelöscht"}: ${path} (${why})`);
  }
}

// ----- Hörbuch-Ordner je Heft -----
function sweepAudio(s: Sweep, docs: Set<string>): void {
  const root = join(DATA_DIR, "audio");
  const chapters = new Map<string, { doc: string; done: boolean }>(
    (db().prepare("SELECT c.id, c.document_id, a.status FROM chapters c LEFT JOIN audio a ON a.chapter_id = c.id").all() as Array<{ id: string; document_id: string; status: string | null }>).map(
      (r) => [r.id, { doc: r.document_id, done: r.status === "done" }]
    )
  );
  const keep = new Set(
    (db().prepare("SELECT stored_path FROM audio WHERE stored_path IS NOT NULL AND stored_path <> ''").all() as Array<{ stored_path: string }>).map((r) => resolve(fromDataPath(r.stored_path)))
  );
  const units = db().prepare("SELECT document_id, idx, audio_path FROM learn_units").all() as Array<{ document_id: string; idx: number; audio_path: string | null }>;

  for (const name of list(root)) {
    // Eigene Bereiche mit eigener Pflege
    if (name.startsWith("_")) continue;
    const dir = join(root, name);
    if (name === "compare") {
      sweepCompare(s, dir, docs);
      continue;
    }
    if (!docs.has(name)) {
      s.remove(dir, "Heft gelöscht");
      continue;
    }
    for (const entry of list(dir)) {
      const path = join(dir, entry);
      if (entry.startsWith(".tmp-")) {
        // Zwischenstücke: nach Erfolg überflüssig, sonst Fortsetzungs-Vorrat bis 7 Tage
        const ch = chapters.get(entry.slice(5));
        if (!ch || ch.doc !== name || ch.done || age(path) > 7 * DAY) s.remove(path, "Zwischenstücke");
      } else if (/^chapter-.*\.mp3$/.test(entry)) {
        if (!keep.has(resolve(path))) s.remove(path, "Kapitel ohne Eintrag");
      } else if (entry === "learn") {
        sweepLearn(s, path, units.filter((u) => u.document_id === name));
      }
    }
  }
}

function sweepLearn(s: Sweep, dir: string, units: Array<{ idx: number; audio_path: string | null }>): void {
  const done = new Set(units.filter((u) => u.audio_path && existsSync(u.audio_path)).map((u) => resolve(u.audio_path!)));
  const count = units.length;
  for (const entry of list(dir)) {
    const path = join(dir, entry);
    const m = /^unit-(\d{3})(\.mp3)?$/.exec(entry);
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    if (m[2]) {
      // Einheit-MP3: gilt, solange sie eingetragen ist; unit-000 ist das Intro beim Sprechen (wird umbenannt)
      if (idx >= 0 && !done.has(resolve(path))) s.remove(path, "Einheit ohne Eintrag");
    } else if (idx >= count || done.has(resolve(join(dir, `${entry}.mp3`))) || age(path) > 7 * DAY) {
      s.remove(path, "Stücke einer fertigen Einheit");
    }
  }
}

function sweepCompare(s: Sweep, dir: string, docs: Set<string>): void {
  for (const doc of list(dir)) {
    const docDir = join(dir, doc);
    if (!docs.has(doc)) {
      s.remove(docDir, "Vergleich eines gelöschten Hefts");
      continue;
    }
    for (const runId of list(docDir)) {
      const path = join(docDir, runId);
      if (age(path) > 14 * DAY) s.remove(path, "alter Stimmvergleich");
    }
  }
}

// ----- Cover -----
function sweepCovers(s: Sweep, docs: Map<string, number>): void {
  const dir = join(DATA_DIR, "covers");
  const newest = new Map<string, { path: string; mtime: number }>();
  for (const entry of list(dir)) {
    const path = join(dir, entry);
    const id = /^([0-9a-f-]{36})/i.exec(entry)?.[1];
    if (!id) continue;
    if (!docs.has(id)) {
      s.remove(path, "Cover eines gelöschten Hefts");
      continue;
    }
    if (/-tmp-/.test(entry)) {
      if (age(path) > DAY) s.remove(path, "Rest einer Seitenumwandlung");
      continue;
    }
    const page = /-p(\d+)\.jpg$/.exec(entry);
    if (page) {
      const want = docs.get(id)! > 0 ? docs.get(id)! : 1;
      if (Number(page[1]) !== want) s.remove(path, "Coverseite nicht mehr gewählt");
      continue;
    }
    // Vorlagen: <heft>-<vorlage>-<stempel>.png, je Heft und Vorlage nur die neueste behalten
    const tpl = /^(.{36}-[a-z])-[0-9a-f]+\.png$/i.exec(entry);
    if (tpl) {
      const mtime = statSync(path).mtimeMs;
      const prev = newest.get(tpl[1]);
      if (!prev) newest.set(tpl[1], { path, mtime });
      else if (mtime > prev.mtime) {
        s.remove(prev.path, "ältere Cover-Fassung");
        newest.set(tpl[1], { path, mtime });
      } else s.remove(path, "ältere Cover-Fassung");
    }
  }
}

// ----- Hörbücher-Ordner: Kopien unter Namen, die nicht mehr gelten -----
async function sweepExports(s: Sweep, docs: Set<string>): Promise<void> {
  const { bookFileName } = await import("./audiobook/export");
  const { learnFileSuffix } = await import("./learnbook/meta");
  const expected = (docId: string, kind: "original" | "subject" | "language") => {
    const base = bookFileName(docId);
    return resolve(join(AUDIOBOOK_EXPORT_DIR, kind === "original" ? base : base.replace(/\.m4b$/i, `${learnFileSuffix(kind)}.m4b`)));
  };
  const reg = readRegistry();
  let changed = false;
  for (const [path, e] of Object.entries(reg)) {
    if (!existsSync(path)) {
      delete reg[path];
      changed = true;
    } else if (!docs.has(e.docId) || expected(e.docId, e.kind) !== path) {
      s.remove(path, "alte Kopie im Hörbücher-Ordner");
      delete reg[path];
      changed = true;
    }
  }
  if (changed && !s.dry) writeFileSync(REGISTRY(), JSON.stringify(reg, null, 1));

  // Ältere Kopien von vor dieser Ablage: nur löschen, wenn ihr Titel-Tag genau zum Buch eines Hefts passt, dessen
  // gültige Kopie unter dem aktuellen Namen daneben liegt
  const titles = new Map<string, string[]>();
  for (const d of db().prepare("SELECT id, title, doc_title FROM documents").all() as Array<{ id: string; title: string; doc_title: string | null }>) {
    const t = (d.title || d.doc_title || "").trim();
    if (t && existsSync(expected(d.id, "original"))) titles.set(t, [...(titles.get(t) ?? []), expected(d.id, "original")]);
  }
  for (const entry of list(AUDIOBOOK_EXPORT_DIR)) {
    if (!/\.m4b$/i.test(entry)) continue;
    const path = resolve(join(AUDIOBOOK_EXPORT_DIR, entry));
    if (reg[path]) continue;
    const tags = await m4bTags(path);
    if (tags?.genre !== "Audiobook" || !tags.title) continue;
    const current = titles.get(tags.title.trim());
    if (current?.length && !current.includes(path)) s.remove(path, "ältere Kopie desselben Hörbuchs");
  }
}

async function m4bTags(path: string): Promise<{ title?: string; genre?: string } | null> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "quiet", "-show_entries", "format_tags=title,genre", "-of", "json", path]);
    return (JSON.parse(stdout) as { format?: { tags?: { title?: string; genre?: string } } }).format?.tags ?? null;
  } catch {
    return null;
  }
}

// ----- Ablauf -----
let running = false;
export async function cleanup(opts: { dry?: boolean } = {}): Promise<CleanupResult> {
  if (running) return { files: 0, bytes: 0, skipped: "läuft schon" };
  if (anyGenerating() || learnBusy()) return { files: 0, bytes: 0, skipped: "Hörbuch läuft" };
  running = true;
  const s = new Sweep(!!opts.dry);
  try {
    const rows = db().prepare("SELECT id, thumb_page FROM documents").all() as Array<{ id: string; thumb_page: number | null }>;
    const ids = new Set(rows.map((r) => r.id));
    sweepAudio(s, ids);
    sweepCovers(s, new Map(rows.map((r) => [r.id, r.thumb_page ?? 1])));
    await sweepExports(s, ids);
    if (s.files && !s.dry) emitLog("info", "cleanup", `Aufgeräumt: ${s.files} Dateien/Ordner, ${(s.bytes / 1024 ** 3).toFixed(2)} GB frei`);
    return { files: s.files, bytes: s.bytes };
  } catch (err) {
    emitLog("warn", "cleanup", "Aufräumen unterbrochen", { err });
    return { files: s.files, bytes: s.bytes };
  } finally {
    running = false;
  }
}

export function startCleanup(): void {
  if (process.env.PM_CLEANUP === "0") return;
  setTimeout(() => void cleanup(), 5 * 60_000).unref?.();
  setInterval(() => void cleanup(), INTERVAL_MS).unref?.();
}
