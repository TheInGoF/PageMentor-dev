// Hörbuch-Lauf für mehrere Bücher: Docling, Intro, Sprachausgabe samt Bereinigung, M4B, Audiobookshelf
// Strikt nacheinander, nie zwei Dinge gleichzeitig auf der Grafikkarte: erst Docling für alle,
// dann Speicher freigeben, dann Buch für Buch. Jeder Schritt nur, wenn sein Ergebnis noch fehlt.
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
import { anyGenerating, cancelAudiobook, generateAudiobook, getRunProgress, isIncluded } from "../audiobook";
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
export function enqueue(docIds: string[], opts: { voiceId: string; rate: string; model?: string; abs: boolean }): BatchState {
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
  if (!state || state.status === "running") return;
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
    const open = state.items.filter((i) => i.step === "wait" || i.step === "docling" || i.step === "audio" || i.step === "abs");
    if (!open.length) break;

    // 1. Docling für alle, die noch keinen Text haben
    let usedDocling = false;
    for (const item of open) {
      if (cancelRequested) return;
      const row = docRow(item.docId);
      if (!row) {
        set(item, "failed", { error: "Dokument nicht gefunden" });
        continue;
      }
      if (row.ocr_status === "done") continue;
      await waitIdle();
      set(item, "docling");
      await processDocument(item.docId);
      usedDocling = true;
      if (docRow(item.docId)?.ocr_status !== "done") set(item, "failed", { error: "Umwandlung fehlgeschlagen" });
    }
    // Docling-Grafikspeicher freigeben, bevor Gemma und die Stimme loslegen
    if (usedDocling) await releaseDoclingNow();

    // 2.–5. Buch für Buch
    for (const item of open) {
      if (cancelRequested || state.status !== "running") return;
      if (item.step === "failed") continue;
      try {
        await bookSteps(item);
      } catch (err) {
        if (cancelRequested) return;
        set(item, "failed", { error: err instanceof Error ? err.message : String(err) });
        emitLog("warn", "batch", `Hörbuch-Lauf: ${item.title} fehlgeschlagen`, { err });
      }
    }
  }
  if (state?.status === "running" && !cancelRequested) {
    state.status = "done";
    state.finishedAt = Date.now();
    save();
    const ok = state.items.filter((i) => i.step === "done").length;
    emitLog("info", "batch", `Hörbuch-Lauf fertig: ${ok} von ${state.items.length} Büchern`);
  }
}

function missingChapters(docId: string): number {
  const rows = db()
    .prepare(
      `SELECT c.kind, c.include_in_audio, a.status FROM chapters c LEFT JOIN audio a ON a.chapter_id = c.id WHERE c.document_id = ?`
    )
    .all(docId) as Array<{ kind: string; include_in_audio: number | null; status: string | null }>;
  const included = rows.filter(isIncluded);
  return (included.length ? included : rows).filter((r) => r.status !== "done").length;
}

async function bookSteps(item: BatchItem): Promise<void> {
  const s = state!;
  const row = docRow(item.docId)!;
  if (!findVoice(s.voiceId, row.language)) throw new Error(`Stimme nicht gefunden: ${s.voiceId}`);

  // Intro (Vorschlag aus den Metadaten, Gemma für die Aussprache), Bereinigung, Kapitel und M4B: alles im Buch-Lauf, Fertiges wird übersprungen
  const book = join(DATA_DIR, "audio", item.docId, "book.m4b");
  const intro = join(DATA_DIR, "audio", item.docId, "intro.mp3");
  if (!existsSync(book) || !existsSync(intro) || missingChapters(item.docId) > 0) {
    await waitIdle();
    set(item, "audio");
    await generateAudiobook({ docId: item.docId, voiceId: s.voiceId, rate: s.rate, model: s.model });
    if (cancelRequested) return;
    if (!existsSync(book)) {
      const missing = missingChapters(item.docId);
      throw new Error(missing ? `Sprachausgabe fehlgeschlagen, ${missing} Kapitel ${missing === 1 ? "fehlt" : "fehlen"} (Details im Log)` : "Hörbuch-Datei nicht erstellt (Details im Log)");
    }
  }
  const missing = missingChapters(item.docId);

  if (s.abs) {
    set(item, "abs");
    await uploadBook(item.docId);
  }
  set(item, "done", missing ? { note: `${missing} Kapitel ${missing === 1 ? "fehlt" : "fehlen"}` } : {});
}
