// Lernhörbuch-Lauf im Hintergrund, ein Heft nach dem anderen: Skripte, dann Sprache, dann M4B. Probe = nur die erste Einheit, ohne M4B.
// Wartet, solange Umwandlung oder Hörbuch laufen, und gibt vor dem großen Modell den Docling-Speicher frei
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../../db";
import { emitLog } from "../../log/logger";
import { runJob } from "../../log/jobs";
import { withGemmaLock } from "../gemmaLock";
import { anyProcessing } from "../pipeline";
import { anyGenerating } from "../audiobook";
import { releaseDoclingNow } from "../docling/release";
import { learnModel, reviewPoints, scriptStamp, unitsFor, writeUnit } from "./script";
import { learnSettings, listUnits, saveAudio, saveScript, syncUnits } from "./store";
import { audioStamp, buildLearnBook, speakUnit } from "./speak";
import { defaultVoiceFor, findVoice } from "../../tts/voices";
import type { Voice } from "../../tts/engines/base";
import { existsSync } from "node:fs";

export interface LearnRunState {
  docId: string;
  running: boolean;
  phase: "wait" | "script" | "audio" | "book" | "done" | "failed" | "canceled";
  done: number;
  total: number;
  current?: string;
  error?: string;
  probe: boolean;
  model?: string;
  // Fertiges M4B im Hörbücher-Ordner (nur beim ganzen Heft)
  bookPath?: string;
}

const states = new Map<string, LearnRunState>();
const queue: Array<{ docId: string; probe: boolean; rate: string }> = [];
let worker: Promise<void> | null = null;
let cancelDoc: string | null = null;

export function learnState(docId: string): LearnRunState | null {
  return states.get(docId) ?? null;
}

// Für andere GPU-Arbeit (Hörbuch-Stapel): solange ein Lernhörbuch läuft, warten sie
export function learnBusy(): boolean {
  return [...states.values()].some((s) => s.running);
}

export function startLearnbook(docId: string, probe: boolean, rate = "+0%"): LearnRunState {
  const cur = states.get(docId);
  if (cur?.running) return cur;
  const st: LearnRunState = { docId, running: true, phase: "wait", done: 0, total: 0, probe };
  states.set(docId, st);
  queue.push({ docId, probe, rate });
  if (!worker) worker = drain().finally(() => (worker = null));
  return st;
}

export function cancelLearnbook(docId: string): void {
  const i = queue.findIndex((q) => q.docId === docId);
  if (i >= 0) queue.splice(i, 1);
  cancelDoc = docId;
  const st = states.get(docId);
  if (st?.running && st.phase === "wait") Object.assign(st, { running: false, phase: "canceled" });
}

async function drain(): Promise<void> {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const st = states.get(job.docId)!;
    if (!st.running) continue;
    cancelDoc = null;
    try {
      await runJob("learnbook", "learnbook", { docId: job.docId }, async () => {
        await scripts(job!.docId, job!.probe, st);
        if (cancelDoc !== job!.docId) await audio(job!.docId, job!.probe, job!.rate, st);
      });
      Object.assign(st, { running: false, phase: cancelDoc === job.docId ? "canceled" : "done", current: undefined });
    } catch (err) {
      Object.assign(st, { running: false, phase: "failed", error: err instanceof Error ? err.message : String(err) });
      emitLog("warn", "learnbook", "Lernhörbuch fehlgeschlagen", { err, ctx: { docId: job.docId } });
    }
  }
}

async function scripts(docId: string, probe: boolean, st: LearnRunState): Promise<void> {
  const doc = db().prepare("SELECT title, doc_title FROM documents WHERE id = ?").get(docId) as { title: string; doc_title: string | null } | undefined;
  if (!doc) throw new Error("Dokument nicht gefunden");
  const { kind, lang } = learnSettings(docId);
  const plan = unitsFor(docId, kind);
  if (!plan.length) throw new Error("Kein Text für ein Lernhörbuch (erst umwandeln)");
  syncUnits(docId, plan);
  const total = probe ? 1 : plan.length;
  Object.assign(st, { total, phase: "script" });

  for (let idx = 0; idx < total; idx++) {
    if (cancelDoc === docId) return;
    // Nie zwei Dinge gleichzeitig auf der Grafikkarte: Umwandlung und Hörbuch laufen zu Ende
    while (cancelDoc !== docId && (anyProcessing() || anyGenerating())) await sleep(5000);
    const units = listUnits(docId);
    const unit = units.find((u) => u.idx === idx)!;
    const pick = await learnModel(kind);
    st.model = pick.model ?? "Standardmodell";
    const review = reviewPoints(units, idx);
    const stamp = scriptStamp(kind, lang, pick.model ?? "default", unit.source, review);
    st.current = unit.title ?? `Einheit ${idx + 1}`;
    if (unit.script && unit.script_stamp === stamp) {
      st.done = idx + 1;
      continue;
    }
    if (pick.model) await releaseDoclingNow();
    const out = await withGemmaLock(`learnbook ${idx + 1}/${total}`, () =>
      writeUnit({ kind, lang, docTitle: doc.doc_title || doc.title, idx, total: plan.length, unit, review, model: pick.model, ctx: pick.ctx })
    );
    saveScript(docId, idx, { ...out, model: pick.model ?? "default", stamp });
    console.log(`[learnbook] ${doc.title} Einheit ${idx + 1}/${total}: „${out.title}“ (${out.script.length} Zeichen${out.checkNote ? `, ${out.checkNote.split("\n")[0]}` : ""})`);
    st.done = idx + 1;
  }
}

// Stimmen: Hauptsprache des Hefts; beim Sprachkurs die Stimme am Heft für die zweite Sprache, sonst deren Standard
function voicesFor(docId: string, kind: "language" | "subject", lang: string): { main: Voice; second: Voice | null } {
  const doc = db().prepare("SELECT language, voice2 FROM documents WHERE id = ?").get(docId) as { language: string; voice2: string | null };
  const main = findVoice(defaultVoiceFor(doc.language), doc.language);
  if (!main) throw new Error(`Keine Stimme für ${doc.language}`);
  if (kind !== "language") return { main, second: null };
  const id = doc.voice2 && doc.voice2 !== "main" ? doc.voice2 : defaultVoiceFor(lang);
  return { main, second: (id && findVoice(id, lang)) || null };
}

async function audio(docId: string, probe: boolean, rate: string, st: LearnRunState): Promise<void> {
  const { kind, lang } = learnSettings(docId);
  const { main, second } = voicesFor(docId, kind, lang);
  const doc = db().prepare("SELECT title, doc_title FROM documents WHERE id = ?").get(docId) as { title: string; doc_title: string | null };
  const album = `${doc.doc_title || doc.title} – Lernhörbuch`;
  const units = listUnits(docId).filter((u) => u.script).slice(0, probe ? 1 : undefined);
  Object.assign(st, { phase: "audio", done: 0, total: units.length });
  for (const u of units) {
    if (cancelDoc === docId) return;
    while (cancelDoc !== docId && (anyProcessing() || anyGenerating())) await sleep(5000);
    st.current = u.title ?? `Einheit ${u.idx + 1}`;
    const stamp = audioStamp(u.script!, second ? [main, second] : [main], rate);
    if (!(u.audio_path && existsSync(u.audio_path) && u.audio_stamp === stamp)) {
      const r = await speakUnit({ docId, idx: u.idx, title: st.current, album, script: u.script!, main, second, rate, isCanceled: () => cancelDoc === docId });
      saveAudio(docId, u.idx, r.path, stamp, r.durationMs);
    }
    st.done++;
  }
  if (probe || cancelDoc === docId) return;
  Object.assign(st, { phase: "book", current: undefined });
  st.bookPath = await buildLearnBook(docId);
  emitLog("info", "learnbook", `Lernhörbuch abgelegt: ${st.bookPath}`, { ctx: { docId } });
}
