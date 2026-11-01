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
import { learnModel, reviewPoints, scriptStamp, SkipUnit, unitsFor, writeUnit } from "./script";
import { learnIntroOverride, learnSettings, listUnits, saveAudio, saveScript, skipUnit, syncUnits } from "./store";
import { audioStamp, buildLearnBook, learnIntroPath, speakUnit } from "./speak";
import { introText } from "./meta";
import { absEnabled } from "../llmConfig";
import { absReady, uploadBook } from "../audiobookshelf";
import { readFileSync, writeFileSync } from "node:fs";
import { defaultVoiceFor, findVoice } from "../../tts/voices";
import type { Voice } from "../../tts/engines/base";
import { existsSync } from "node:fs";

export interface LearnRunState {
  docId: string;
  running: boolean;
  phase: "wait" | "script" | "audio" | "intro" | "book" | "abs" | "done" | "failed" | "canceled";
  done: number;
  total: number;
  current?: string;
  error?: string;
  probe: boolean;
  model?: string;
  // Fertiges M4B im Hörbücher-Ordner (nur beim ganzen Heft)
  bookPath?: string;
  // Audiobookshelf: hochgeladen oder Fehlermeldung (das M4B ist trotzdem fertig)
  absUrl?: string;
  absError?: string;
  // Wartet gerade auf die Grafikkarte (Umwandlung oder Hörbuch läuft)
  waiting?: boolean;
  // Innerhalb der aktuellen Einheit: Schritt, Start (ms) und beim Sprechen gesprochene Stücke
  step?: "write" | "check" | "revise" | "speak";
  unitStartedAt?: number;
  partsDone?: number;
  partsTotal?: number;
}

const states = new Map<string, LearnRunState>();
// introOnly: nur das Intro neu sprechen und das M4B neu bauen, Einheiten bleiben
const queue: Array<{ docId: string; probe: boolean; rate: string; introOnly?: boolean }> = [];
let worker: Promise<void> | null = null;
let cancelDoc: string | null = null;

export function learnState(docId: string): LearnRunState | null {
  return states.get(docId) ?? null;
}

// Für andere GPU-Arbeit (Hörbuch-Stapel): solange ein Lernhörbuch läuft, warten sie
export function learnBusy(): boolean {
  return [...states.values()].some((s) => s.running);
}

// Gerade auf der Grafikkarte (eine Einheit schreiben oder sprechen); dazwischen dürfen andere ran
let unitActive = false;
export function learnUnitActive(): boolean {
  return unitActive;
}
// Warten, bis Umwandlung und Hörbuch fertig sind, dann sofort (ohne await dazwischen) die Karte belegen:
// so sieht eine gleichzeitig startende Umwandlung den Platz besetzt und wartet ihrerseits
async function gpuSlot<T>(docId: string, fn: () => Promise<T>): Promise<T | undefined> {
  const st = states.get(docId);
  while (cancelDoc !== docId && (anyProcessing() || anyGenerating())) {
    if (st) st.waiting = true;
    await sleep(5000);
  }
  if (st) st.waiting = false;
  if (cancelDoc === docId) return undefined;
  unitActive = true;
  try {
    return await fn();
  } finally {
    unitActive = false;
  }
}

export function learnStates(): LearnRunState[] {
  return [...states.values()];
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

// Intro nach einer Änderung einzeln neu sprechen; das M4B wird danach mit den vorhandenen Einheiten neu gebaut
export function startLearnIntro(docId: string, rate = "+0%"): LearnRunState {
  const cur = states.get(docId);
  if (cur?.running) return cur;
  const st: LearnRunState = { docId, running: true, phase: "wait", done: 0, total: 1, probe: false };
  states.set(docId, st);
  queue.push({ docId, probe: false, rate, introOnly: true });
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
        if (job!.introOnly) return await introAndBook(job!.docId, job!.rate, st);
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
  // Probe: bis zur ersten Einheit mit Inhalt (leere Einheiten am Anfang werden übersprungen)
  const total = plan.length;
  Object.assign(st, { total: probe ? 1 : total, phase: "script" });

  for (let idx = 0; idx < total; idx++) {
    if (cancelDoc === docId) return;
    // Nie zwei Dinge gleichzeitig auf der Grafikkarte: Umwandlung und Hörbuch laufen zu Ende
    await gpuSlot(docId, async () => {
      const units = listUnits(docId);
      const unit = units.find((u) => u.idx === idx)!;
      const pick = await learnModel(kind);
      st.model = pick.model ?? "Standardmodell";
      const review = reviewPoints(units, idx);
      const stamp = scriptStamp(kind, lang, pick.model ?? "default", unit.source, review);
      st.current = unit.title ?? `Einheit ${idx + 1}`;
      if ((unit.script || unit.skip_reason) && unit.script_stamp === stamp) return;
      Object.assign(st, { step: "write", unitStartedAt: Date.now(), partsDone: undefined, partsTotal: undefined });
      if (pick.model) await releaseDoclingNow();
      // Keine Inhalte oder kein Skript: Einheit markieren, sie fehlt im Hörbuch; der Lauf geht weiter
      const out = await withGemmaLock(`learnbook ${idx + 1}/${total}`, () =>
        writeUnit({ kind, lang, docTitle: doc.doc_title || doc.title, idx, total: plan.length, unit, review, model: pick.model, ctx: pick.ctx, onStep: (step) => (st.step = step) })
      ).catch((err) => {
        if (!(err instanceof SkipUnit)) throw err;
        skipUnit(docId, idx, err.message, err.final ? stamp : null);
        emitLog("warn", "learnbook", `Einheit ${idx + 1} übersprungen: ${err.message}`, { ctx: { docId } });
        return null;
      });
      if (!out) return;
      saveScript(docId, idx, { ...out, model: pick.model ?? "default", stamp });
      console.log(`[learnbook] ${doc.title} Einheit ${idx + 1}/${total}: „${out.title}“ (${out.script.length} Zeichen${out.checkNote ? `, ${out.checkNote.split("\n")[0]}` : ""})`);
    });
    if (cancelDoc === docId) return;
    if (probe) {
      if (listUnits(docId).find((u) => u.idx === idx)?.script) {
        st.done = 1;
        return;
      }
      continue;
    }
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
    await gpuSlot(docId, async () => {
      st.current = u.title ?? `Einheit ${u.idx + 1}`;
      const stamp = audioStamp(u.script!, second ? [main, second] : [main], rate);
      if (!(u.audio_path && existsSync(u.audio_path) && u.audio_stamp === stamp)) {
        Object.assign(st, { step: "speak", unitStartedAt: Date.now(), partsDone: 0, partsTotal: undefined });
        const r = await speakUnit({
          docId, idx: u.idx, title: st.current, album, script: u.script!, main, second, rate,
          isCanceled: () => cancelDoc === docId,
          onProgress: (done, total) => Object.assign(st, { partsDone: done, partsTotal: total }),
        });
        saveAudio(docId, u.idx, r.path, stamp, r.durationMs);
      }
    });
    if (cancelDoc === docId) return;
    st.done++;
  }
  if (probe || cancelDoc === docId) return;
  await finishBook(docId, kind, lang, main, rate, st, units.length);
}

// Nur Intro und M4B: nach einer Änderung am Intro, ohne Einheiten anzufassen
async function introAndBook(docId: string, rate: string, st: LearnRunState): Promise<void> {
  const { kind, lang } = learnSettings(docId);
  const { main } = voicesFor(docId, kind, lang);
  const units = listUnits(docId).filter((u) => u.script && !u.skip_reason);
  if (!units.length) throw new Error("Noch keine Einheiten mit Skript");
  st.current = "Einleitung";
  await finishBook(docId, kind, lang, main, rate, st, units.length);
}

async function finishBook(docId: string, kind: "language" | "subject", lang: string, main: Voice, rate: string, st: LearnRunState, unitCount: number): Promise<void> {
  // Intro vorneweg: was es ist, nach wessen Buch, wie man damit lernt; nur neu sprechen, wenn sich etwas geändert hat
  st.phase = "intro";
  const intro = await gpuSlot(docId, () => speakIntro(docId, kind, lang, main, rate, unitCount));
  if (cancelDoc === docId) return;
  // M4B nur, wenn alle Einheiten mit Inhalt Audio haben (sonst fehlt nach „Intro neu“ noch ein Lauf)
  const ready = listUnits(docId).filter((u) => u.script && !u.skip_reason).every((u) => u.audio_path && existsSync(u.audio_path));
  if (!ready) return;
  Object.assign(st, { phase: "book", current: undefined });
  st.bookPath = await buildLearnBook(docId, intro ?? null);
  emitLog("info", "learnbook", `Lernhörbuch abgelegt: ${st.bookPath}`, { ctx: { docId } });
  // Wie beim Original-Hörbuch: mit eingeschaltetem Audiobookshelf gleich hochladen, als eigener Eintrag
  if (absEnabled() && absReady()) {
    st.phase = "abs";
    try {
      st.absUrl = (await uploadBook(docId, kind)).url;
    } catch (err) {
      st.absError = err instanceof Error ? err.message : String(err);
      emitLog("warn", "learnbook", "Lernhörbuch nicht zu Audiobookshelf hochgeladen", { err, ctx: { docId } });
    }
  }
}

// Aktueller Intro-Text: eigene Fassung oder Vorlage
export function learnIntroInfo(docId: string): { text: string; template: string; custom: boolean; hasAudio: boolean } {
  const { kind, lang } = learnSettings(docId);
  const doc = db().prepare("SELECT title, doc_title, author FROM documents WHERE id = ?").get(docId) as { title: string; doc_title: string | null; author: string | null };
  const units = listUnits(docId).filter((u) => !u.skip_reason).length;
  const template = introText({ kind, lang, title: doc.doc_title || doc.title, author: doc.author, units });
  const custom = learnIntroOverride(docId, kind);
  return { text: custom ?? template, template, custom: !!custom, hasAudio: existsSync(learnIntroPath(docId)) };
}

async function speakIntro(docId: string, kind: "language" | "subject", lang: string, main: Voice, rate: string, units: number): Promise<{ path: string; durationMs: number } | null> {
  const doc = db().prepare("SELECT title, doc_title, author FROM documents WHERE id = ?").get(docId) as { title: string; doc_title: string | null; author: string | null };
  const text = learnIntroOverride(docId, kind) ?? introText({ kind, lang, title: doc.doc_title || doc.title, author: doc.author, units });
  const stamp = audioStamp(text, [main], rate);
  const path = learnIntroPath(docId);
  const meta = `${path}.json`;
  try {
    const m = JSON.parse(readFileSync(meta, "utf8")) as { stamp: string; durationMs: number };
    if (m.stamp === stamp && existsSync(path)) return { path, durationMs: m.durationMs };
  } catch {
    // noch kein Intro
  }
  const r = await speakUnit({ docId, idx: -1, title: "Einleitung", album: doc.doc_title || doc.title, script: text, main, second: null, rate, isCanceled: () => cancelDoc === docId });
  // speakUnit legt Einheit 0 (idx -1) als unit-000.mp3 ab; als intro.mp3 merken
  const { renameSync } = await import("node:fs");
  renameSync(r.path, path);
  writeFileSync(meta, JSON.stringify({ stamp, durationMs: r.durationMs }));
  return { path, durationMs: r.durationMs };
}

// Fertiges Lernhörbuch (nachträglich) zu Audiobookshelf
export async function uploadLearnbook(docId: string): Promise<{ url?: string }> {
  const { kind } = learnSettings(docId);
  return { url: (await uploadBook(docId, kind)).url };
}
