// Hörbuch-Lauf für mehrere Bücher: Docling, Intro, Sprachausgabe samt Bereinigung, M4B, Audiobookshelf
// Strikt nacheinander, nie zwei Dinge gleichzeitig auf der Grafikkarte: Heft für Heft oder erst alle
// Umwandlungen und dann alle Hörbücher; Docling gibt den Speicher vor der Sprachausgabe frei. Jeder Schritt nur, wenn sein Ergebnis noch fehlt.
// Die Warteschlange liegt als Datei im Datenordner; nach einem Neustart geht es erst nach Bestätigung weiter.
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { setTimeout as sleep } from "timers/promises";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { emitLog } from "../../log/logger";
import { findVoice } from "../../tts/voices";
import { anyProcessing, cancelProcessing, processDocument } from "../pipeline";
import { releaseDoclingNow } from "../docling/release";
import { anyGenerating, cancelAudiobook, generateAudiobook, getRunProgress, hasSpeakableText, isIncluded } from "../audiobook";
import { absReady, uploadBook } from "../audiobookshelf";

export type Step = "wait" | "docling" | "audio" | "abs" | "done" | "failed" | "canceled";

export interface BatchItem {
  docId: string;
  title: string;
  step: Step;
  error?: string;
  // Hinweis bei Erfolg, z. B. fehlende Kapitel
  note?: string;
}

export interface BatchState {
  id: string;
  status: "running" | "paused" | "done" | "canceled";
  voiceId: string;
  rate: string;
  model?: string;
  abs: boolean;
  // book: jedes Buch komplett, dann das nächste; phase: erst alle Umwandlungen, dann alle Hörbücher
  order: "book" | "phase";
  items: BatchItem[];
  startedAt: number;
  finishedAt?: number;
}

const FILE = join(DATA_DIR, "batch-audiobooks.json");
let state: BatchState | null = load();
let worker: Promise<void> | null = null;
let cancelRequested = false;

function load(): BatchState | null {
  try {
    const s = JSON.parse(readFileSync(FILE, "utf8")) as BatchState;
    // Nach Neustart: unterbrochener Lauf wartet auf Bestätigung
    if (s.status === "running") s.status = "paused";
    return s;
  } catch {
    return null;
  }
}

function save(): void {
  if (!state) return;
  try {
    writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    emitLog("warn", "batch", "Hörbuch-Lauf nicht gespeichert", { err });
  }
}

function docRow(id: string) {
  return db().prepare("SELECT id, title, doc_title, author, language, ocr_status, audio_intro_text FROM documents WHERE id = ?").get(id) as
    | { id: string; title: string; doc_title: string | null; author: string | null; language: string; ocr_status: string; audio_intro_text: string | null }
    | undefined;
}

// Status samt Live-Fortschritt des laufenden Buchs
export function batchStatus(): (BatchState & { current?: { docId: string; chapter: number; chapters: number; chunk: number; chunks: number } }) | null {
  if (!state) return null;
  const active = state.items.find((i) => i.step === "audio");
  const p = active ? getRunProgress(active.docId) : null;
  return {
    ...state,
    current: active && p ? { docId: active.docId, chapter: p.currentChapter, chapters: p.totalChapters, chunk: p.chunkCurrent, chunks: p.chunkTotal } : undefined,
  };
}

// Neuer Lauf oder Nachschieben in den laufenden; Bücher, die schon drin sind, nicht doppelt
export function enqueue(docIds: string[], opts: { voiceId: string; rate: string; model?: string; abs: boolean; order: "book" | "phase" }): BatchState {
  const fresh = !state || state.status === "done" || state.status === "canceled";
  if (fresh) {
    state = { id: `${Date.now()}`, status: "running", ...opts, abs: opts.abs && absReady(), items: [], startedAt: Date.now() };
  }
  const known = new Set(state!.items.map((i) => i.docId));
  for (const id of docIds) {
    const row = docRow(id);
    if (!row || known.has(id)) continue;
    state!.items.push({ docId: id, title: row.title || row.doc_title || id, step: "wait" });
  }
  if (state!.status === "paused") state!.status = "running";
  save();
  start();
  return state!;
}

// Wartende Bücher umsortieren; laufende und fertige behalten ihren Platz
export function reorder(docIds: string[]): void {
  if (!state) return;
  const rank = (id: string) => {
    const i = docIds.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const waiting = state.items.filter((i) => i.step === "wait").sort((a, b) => rank(a.docId) - rank(b.docId));
  state.items = state.items.map((i) => (i.step === "wait" ? waiting.shift()! : i));
  save();
}

export function resume(): void {
  if (state?.status !== "paused") return;
  state.status = "running";
  save();
  start();
}

// Lauf verwerfen bzw. abbrechen: laufende Schritte stoppen, Fertiges bleibt
export function cancel(): void {
  if (!state) return;
  cancelRequested = true;
  for (const i of state.items) {
    if (i.step === "docling") cancelProcessing(i.docId);
    if (i.step === "audio") cancelAudiobook(i.docId);
    if (!["done", "failed"].includes(i.step)) i.step = "canceled";
  }
  state.status = "canceled";
  state.finishedAt = Date.now();
  save();
}

// Abschluss gesehen: aus der Kopfzeile entfernen
export function dismiss(): void {
  // Auch nach Abbruch erst, wenn der laufende Schritt zu Ende ist; sonst greift run() ins Leere
  if (!state || state.status === "running" || worker) return;
  state = null;
  try {
    writeFileSync(FILE, "null");
  } catch {
    /* egal */
  }
}

function start(): void {
  if (worker) return;
  cancelRequested = false;
  worker = run()
    .catch((err) => emitLog("error", "batch", "Hörbuch-Lauf abgebrochen", { err }))
    .finally(() => (worker = null));
}

// Andere GPU-Arbeit (Umwandlung, einzelnes Hörbuch) erst zu Ende laufen lassen
async function waitIdle(): Promise<void> {
  while (!cancelRequested && (anyProcessing() || anyGenerating())) await sleep(3000);
}

function set(item: BatchItem, step: Step, extra: Partial<BatchItem> = {}): void {
  Object.assign(item, { step, ...extra });
  save();
}

async function run(): Promise<void> {
  // Mehrfach durchlaufen: nachgeschobene Bücher kommen in der nächsten Runde dran
  while (state?.status === "running" && !cancelRequested) {
    // Immer das erste offene Buch nach aktueller Reihenfolge: Umsortieren wirkt sofort
    const next = (pred: (i: BatchItem) => boolean) => state?.items.find((i) => OPEN.has(i.step) && pred(i));
    if (!next(() => true)) break;

    if (state.order === "phase") {
      // Erst alle Umwandlungen, dann den Docling-Speicher freigeben, dann alle Hörbücher
      let used = false;
      for (let item = next(needsText); item && !cancelRequested; item = next(needsText)) used = (await convert(item)) || used;
      if (used) await releaseDoclingNow();
      // Nachgeschobene ohne Text kommen in der nächsten Runde zur Umwandlung
      const ready = (i: BatchItem) => !needsText(i);
      for (let item = next(ready); item && !cancelRequested && state?.status === "running"; item = next(ready)) await safeBook(item);
    } else {
      // Heft für Heft: umwandeln, Speicher freigeben, Hörbuch, dann das nächste
      for (let item = next(() => true); item && !cancelRequested && state?.status === "running"; item = next(() => true)) {
        if (needsText(item) && (await convert(item))) await releaseDoclingNow();
        if (OPEN.has(item.step)) await safeBook(item);
      }
    }
    if (cancelRequested || state?.status !== "running") return;
  }
  if (state?.status === "running" && !cancelRequested) {
    state.status = "done";
    state.finishedAt = Date.now();
    save();
    const ok = state.items.filter((i) => i.step === "done").length;
    emitLog("info", "batch", `Hörbuch-Lauf fertig: ${ok} von ${state.items.length} Büchern`);
  }
}

const OPEN = new Set<Step>(["wait", "docling", "audio", "abs"]);

function needsText(item: BatchItem): boolean {
  return docRow(item.docId)?.ocr_status !== "done";
}

// Docling für ein Buch; true, wenn umgewandelt wurde (dann liegt Docling im Grafikspeicher)
async function convert(item: BatchItem): Promise<boolean> {
  if (!docRow(item.docId)) {
    set(item, "failed", { error: "Dokument nicht gefunden" });
    return false;
  }
  await waitIdle();
  set(item, "docling");
  await processDocument(item.docId);
  if (needsText(item)) set(item, "failed", { error: "Umwandlung fehlgeschlagen" });
  return true;
}

async function safeBook(item: BatchItem): Promise<void> {
  try {
    await bookSteps(item);
  } catch (err) {
    if (cancelRequested) return;
    set(item, "failed", { error: err instanceof Error ? err.message : String(err) });
    emitLog("warn", "batch", `Hörbuch-Lauf: ${item.title} fehlgeschlagen`, { err });
  }
}

function missingChapters(docId: string): number {
  const rows = db()
    .prepare(
      `SELECT c.kind, c.include_in_audio, c.text, a.status FROM chapters c LEFT JOIN audio a ON a.chapter_id = c.id WHERE c.document_id = ?`
    )
    .all(docId) as Array<{ kind: string; include_in_audio: number | null; text: string | null; status: string | null }>;
  const included = rows.filter(isIncluded);
  return (included.length ? included : rows).filter((r) => hasSpeakableText(r) && r.status !== "done").length;
}

async function bookSteps(item: BatchItem): Promise<void> {
  const s = state!;
  const row = docRow(item.docId)!;
  if (!findVoice(s.voiceId, row.language)) throw new Error(`Stimme nicht gefunden: ${s.voiceId}`);

  // Intro (Vorschlag aus den Metadaten, Gemma für die Aussprache), Bereinigung, Kapitel und M4B im Buch-Lauf.
  // Er überspringt, was fertig und aktuell ist (Versionsstempel), und baut veraltete Teile neu
  const book = join(DATA_DIR, "audio", item.docId, "book.m4b");
  await waitIdle();
  set(item, "audio");
  const { regenerated } = await generateAudiobook({ docId: item.docId, voiceId: s.voiceId, rate: s.rate, model: s.model });
  if (cancelRequested) return;
  if (!existsSync(book)) {
    const missing = missingChapters(item.docId);
    throw new Error(missing ? `Sprachausgabe fehlgeschlagen, ${missing} Kapitel ${missing === 1 ? "fehlt" : "fehlen"} (Details im Log)` : "Hörbuch-Datei nicht erstellt (Details im Log)");
  }
  const missing = missingChapters(item.docId);

  // Hochladen, wenn neu erzeugt wurde oder noch nie hochgeladen; die neue Fassung ersetzt die alte
  const uploaded = !!(db().prepare("SELECT abs_item_id FROM documents WHERE id = ?").get(item.docId) as { abs_item_id: string | null } | undefined)?.abs_item_id;
  if (s.abs && (regenerated > 0 || !uploaded)) {
    set(item, "abs");
    await uploadBook(item.docId);
  }
  set(item, "done", missing ? { note: `${missing} Kapitel ${missing === 1 ? "fehlt" : "fehlen"}` } : {});
}
