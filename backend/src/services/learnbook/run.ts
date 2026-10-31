// Lernhörbuch-Lauf im Hintergrund, ein Heft nach dem anderen. Probe = nur die erste Einheit.
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
import { learnSettings, listUnits, saveScript, syncUnits } from "./store";

export interface LearnRunState {
  docId: string;
  running: boolean;
  phase: "wait" | "script" | "done" | "failed" | "canceled";
  done: number;
  total: number;
  current?: string;
  error?: string;
  probe: boolean;
  model?: string;
}

const states = new Map<string, LearnRunState>();
const queue: Array<{ docId: string; probe: boolean }> = [];
let worker: Promise<void> | null = null;
let cancelDoc: string | null = null;

export function learnState(docId: string): LearnRunState | null {
  return states.get(docId) ?? null;
}

// Für andere GPU-Arbeit (Hörbuch-Stapel): solange ein Lernhörbuch läuft, warten sie
export function learnBusy(): boolean {
  return [...states.values()].some((s) => s.running);
}

export function startLearnbook(docId: string, probe: boolean): LearnRunState {
  const cur = states.get(docId);
  if (cur?.running) return cur;
  const st: LearnRunState = { docId, running: true, phase: "wait", done: 0, total: 0, probe };
  states.set(docId, st);
  queue.push({ docId, probe });
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
      await runJob("learnbook", "learnbook", { docId: job.docId }, () => scripts(job!.docId, job!.probe, st));
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
