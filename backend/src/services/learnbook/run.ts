// Lernhörbuch-Lauf im Hintergrund: Skripte, dann Sprache, dann M4B. Probe = nur die erste Einheit, ohne M4B.
// Jeder Lauf hat einen Eintrag in der Hauptwarteschlange und holt sich die Grafikkarte je Einheit; dazwischen darf
// ein vorgezogener Auftrag ran. Vor dem großen Modell wird der Docling-Speicher freigegeben
import { db } from "../../db";
import { emitLog } from "../../log/logger";
import { runJob } from "../../log/jobs";
import { withGemmaLock } from "../gemmaLock";
import { acquire, enqueueTicket, release, removeTicket } from "../queue";
import { releaseDoclingNow } from "../docling/release";
import { learnModel, reviewPoints, scriptStamp, SkipUnit, unitsFor, writeUnit } from "./script";
import { learnSettings, listUnits, saveAudio, saveScript, skipUnit, syncUnits } from "./store";
import { audioStamp, buildLearnBook, learnIntroPath, speakUnit } from "./speak";
import { introTtsText } from "../audiobook/intro";
import { getIntro, introAudioUrl } from "../audiobook/introStore";
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
interface Job {
  docId: string;
  probe: boolean;
  rate: string;
  introOnly?: boolean;
}
// Eintrag in der Hauptwarteschlange je laufendem Heft
const tickets = new Map<string, string>();
const canceled = new Set<string>();

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
// Die Karte über die Hauptwarteschlange holen, eine Einheit lang behalten, dann zurückgeben
async function gpuSlot<T>(docId: string, fn: () => Promise<T>): Promise<T | undefined> {
  const st = states.get(docId);
  const ticket = tickets.get(docId);
  if (!ticket || canceled.has(docId)) return undefined;
  if (st) st.waiting = true;
  try {
    await acquire(ticket);
  } catch {
    // Eintrag entfernt: Lauf abgebrochen
    canceled.add(docId);
    return undefined;
  } finally {
    if (st) st.waiting = false;
  }
  if (canceled.has(docId)) {
    release(ticket);
    return undefined;
  }
  unitActive = true;
  try {
    return await fn();
  } finally {
    unitActive = false;
    release(ticket);
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
  launch({ docId, probe, rate });
  return st;
}

// Eintrag in die Hauptwarteschlange, eigener Lauf; die Reihenfolge regelt die Warteschlange
function launch(job: Job): void {
  canceled.delete(job.docId);
  tickets.set(job.docId, enqueueTicket("learnbook", job.docId, { probe: job.probe, rate: job.rate, introOnly: !!job.introOnly }).id);
  void runOne(job);
}

// Intro nach einer Änderung einzeln neu sprechen; das M4B wird danach mit den vorhandenen Einheiten neu gebaut
export function startLearnIntro(docId: string, rate = "+0%"): LearnRunState {
  const cur = states.get(docId);
  if (cur?.running) return cur;
  const st: LearnRunState = { docId, running: true, phase: "wait", done: 0, total: 1, probe: false };
  states.set(docId, st);
  launch({ docId, probe: false, rate, introOnly: true });
  return st;
}

// Abbrechen, auch mitten im Lauf: der Eintrag verschwindet aus der Warteschlange, der Lauf endet nach dem Stück
export function cancelLearnbook(docId: string): void {
  canceled.add(docId);
  const ticket = tickets.get(docId);
  if (ticket) removeTicket(ticket);
  const st = states.get(docId);
  if (st?.running && st.phase === "wait") Object.assign(st, { running: false, phase: "canceled" });
}

async function runOne(job: Job): Promise<void> {
  const st = states.get(job.docId)!;
  try {
    await runJob("learnbook", "learnbook", { docId: job.docId }, async () => {
      if (job.introOnly) return await introAndBook(job.docId, job.rate, st);
      await scripts(job.docId, job.probe, st);
      if (!canceled.has(job.docId)) await audio(job.docId, job.probe, job.rate, st);
    });
    Object.assign(st, { running: false, phase: canceled.has(job.docId) ? "canceled" : "done", current: undefined });
  } catch (err) {
    Object.assign(st, { running: false, phase: "failed", error: err instanceof Error ? err.message : String(err) });
    emitLog("warn", "learnbook", "Lernhörbuch fehlgeschlagen", { err, ctx: { docId: job.docId } });
  } finally {
    const ticket = tickets.get(job.docId);
    if (ticket) removeTicket(ticket);
    tickets.delete(job.docId);
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
    if (canceled.has(docId)) return;
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
    if (canceled.has(docId)) return;
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
    if (canceled.has(docId)) return;
    await gpuSlot(docId, async () => {
      st.current = u.title ?? `Einheit ${u.idx + 1}`;
      const stamp = audioStamp(u.script!, second ? [main, second] : [main], rate);
      if (!(u.audio_path && existsSync(u.audio_path) && u.audio_stamp === stamp)) {
        Object.assign(st, { step: "speak", unitStartedAt: Date.now(), partsDone: 0, partsTotal: undefined });
        const r = await speakUnit({
          docId, idx: u.idx, title: st.current, album, script: u.script!, main, second, rate,
          isCanceled: () => canceled.has(docId),
          onProgress: (done, total) => Object.assign(st, { partsDone: done, partsTotal: total }),
        });
        saveAudio(docId, u.idx, r.path, stamp, r.durationMs);
      }
    });
    if (canceled.has(docId)) return;
    st.done++;
  }
  if (probe || canceled.has(docId)) return;
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
  const intro = await gpuSlot(docId, () => speakIntro(docId, kind, main, rate));
  if (canceled.has(docId)) return;
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

// Intro für den Editor im Hörbuch-Reiter (gleicher wie beim Original): Text, Vorlage, Audio
export function learnIntroInfo(docId: string): { text: string | null; template: string | null; custom: boolean; audioUrl: string | null } {
  const { kind } = learnSettings(docId);
  const intro = getIntro(docId, kind);
  return { text: intro?.text ?? null, template: intro?.template ?? null, custom: !!intro?.custom, audioUrl: introAudioUrl(docId, kind) };
}

// Wie beim Original: gesprochen wird Gemmas Sprachfassung (gecacht), ohne Gemma der ausgeschriebene Text
async function speakIntro(docId: string, kind: "language" | "subject", main: Voice, rate: string): Promise<{ path: string; durationMs: number } | null> {
  const doc = db().prepare("SELECT title, doc_title FROM documents WHERE id = ?").get(docId) as { title: string; doc_title: string | null };
  const text = await introTtsText(docId, undefined, kind);
  if (!text) return null;
  const stamp = audioStamp(text, [main], rate);
  const path = learnIntroPath(docId);
  const meta = `${path}.json`;
  try {
    const m = JSON.parse(readFileSync(meta, "utf8")) as { stamp: string; durationMs: number };
    if (m.stamp === stamp && existsSync(path)) return { path, durationMs: m.durationMs };
  } catch {
    // noch kein Intro
  }
  const r = await speakUnit({ docId, idx: -1, title: "Einleitung", album: doc.doc_title || doc.title, script: text, main, second: null, rate, isCanceled: () => canceled.has(docId) });
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
