// Warteschlange auf einen Blick: vorn die Einträge der Hauptwarteschlange (Umwandlung, Hörbuch, Lernhörbuch) in
// ihrer Reihenfolge, verschiebbar und entfernbar; dahinter Stapel-Import, Hörbuch-Stapel, Wissenspflege,
// Begriffsnetz und Stimm-Engines, nur zum Lesen
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../db";
import { cancelProcessing, isProcessing, pipelineStages, processDocument } from "./pipeline";
import { queueStatus } from "./batch/queue";
import { cancelLearnbook, learnStates, startLearnbook, startLearnIntro } from "./learnbook/run";
import { learnSettings } from "./learnbook/store";
import { cancelAudiobook, running as audioRuns } from "./audiobook/state";
import { generateAudiobook } from "./audiobook/book";
import { emitLog } from "../log/logger";
import { discardPaused, pausedTickets, queueTickets, removeTicket, reorderTickets, takePaused, type QueueKind, type Ticket } from "./queue";
import { batchStatus } from "./batch/audiobooks";
import { maintenanceState } from "./maintenance";
import { conceptRunState } from "./concepts/extract";
import { ttsActivity, type TtsActivity } from "./ttsActivity";
import { pronRunState } from "./pronCheck/run";

export interface ActivityItem {
  kind: "docling" | "import" | "learnbook" | "audiobook" | "batch" | "maintenance" | "concepts" | "tts" | "proncheck";
  status: "running" | "waiting";
  title: string;
  // Schlüssel für die Anzeige, z. B. "wait", "script", "audio"
  step?: string;
  detail?: string;
  done?: number;
  total?: number;
  docId?: string;
  // Zwischenschritt, z. B. Lernhörbuch "check" (prüft gegen das Heft)
  sub?: string;
  // Lernhörbuch: Fachheft oder Sprachkurs (für den passenden Knopf im Hörbuch-Reiter)
  learnKind?: "subject" | "language";
  // Eintrag der Hauptwarteschlange: verschiebbar, solange er die Grafikkarte nicht hält; entfernbar immer
  ticket?: string;
  movable?: boolean;
}

function docTitle(docId: string): string {
  const r = db().prepare("SELECT title, doc_title FROM documents WHERE id = ?").get(docId) as { title: string; doc_title: string | null } | undefined;
  return r ? r.doc_title || r.title : docId;
}

// Eintrag der Hauptwarteschlange mit dem Stand seines Auftrags
function ticketItem(tk: Ticket): ActivityItem | null {
  const base = { ticket: tk.id, movable: !tk.active, docId: tk.docId, title: docTitle(tk.docId) };
  if (tk.kind === "docling") {
    const stage = pipelineStages().find((p) => p.docId === tk.docId)?.stage ?? "wait";
    return { kind: "docling", status: tk.active ? "running" : "waiting", step: tk.active ? stage : "wait", ...base };
  }
  if (tk.kind === "learnbook") {
    const s = learnStates().find((x) => x.docId === tk.docId && x.running);
    if (!s) return null;
    const waiting = s.phase === "wait" || !!s.waiting;
    return { kind: "learnbook", status: waiting ? "waiting" : "running", step: s.phase, detail: s.current, done: s.done, total: s.total, sub: waiting ? undefined : s.step, learnKind: learnSettings(tk.docId).kind, ...base };
  }
  const r = audioRuns.get(tk.docId);
  const sub = tk.params.single ? (tk.params.intro ? "intro" : "chapter") : undefined;
  return { kind: "audiobook", status: tk.active ? "running" : "waiting", sub, done: r ? Math.max(0, r.currentChapter - 1) : undefined, total: r?.totalChapters, ...base };
}

export function collectActivity(tts: TtsActivity | null = null): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const tk of queueTickets()) {
    const it = ticketItem(tk);
    if (it) items.push(it);
  }
  const rest: ActivityItem[] = [];
  const q = queueStatus();
  if (q.waiting > 0 || q.running > 0) {
    rest.push({ kind: "import", status: q.running > 0 && !q.paused ? "running" : "waiting", step: q.paused ? "paused" : undefined, title: q.current ?? "", done: q.done, total: q.done + q.waiting + q.running });
  }
  const b = batchStatus();
  if (b && (b.status === "running" || b.status === "paused")) {
    const open = b.items.filter((i) => !["done", "failed", "canceled"].includes(i.step));
    rest.push({ kind: "batch", status: b.status === "running" ? "running" : "waiting", step: b.status, title: "", done: b.items.length - open.length, total: b.items.length });
  }
  const m = maintenanceState();
  if (m.status === "running" || m.status === "countdown") {
    rest.push({ kind: "maintenance", status: m.status === "running" ? "running" : "waiting", step: m.phase ?? m.status, title: m.doc ?? "", done: m.done, total: m.total });
  }
  const c = conceptRunState();
  if (c.running && m.status !== "running") rest.push({ kind: "concepts", status: "running", title: c.doc ?? "", detail: c.current, done: c.done, total: c.total });
  const pc = pronRunState();
  if (pc?.running) rest.push({ kind: "proncheck", status: pc.waiting ? "waiting" : "running", title: docTitle(pc.docId), detail: pc.current, done: pc.done, total: pc.total, docId: pc.docId });
  if (tts) rest.push({ kind: "tts", status: "running", step: tts.phase, title: tts.engine, detail: tts.model, done: tts.bytes, total: tts.total });
  // Hauptwarteschlange in ihrer Reihenfolge, dahinter das Übrige: Laufendes zuerst
  return [...items, ...rest.sort((a, b) => Number(a.status === "waiting") - Number(b.status === "waiting"))];
}

export function reorderQueue(ids: string[]): void {
  reorderTickets(ids);
}

// Eintrag entfernen, auch einen laufenden: der Auftrag wird abgebrochen
export function removeQueueEntry(id: string): boolean {
  const tk = queueTickets().find((t) => t.id === id);
  if (!tk) return false;
  if (tk.kind === "docling") cancelProcessing(tk.docId);
  else if (tk.kind === "learnbook") cancelLearnbook(tk.docId);
  else cancelAudiobook(tk.docId);
  removeTicket(id);
  return true;
}

export async function activity(): Promise<ActivityItem[]> {
  return collectActivity(await ttsActivity());
}

// Nach dem Neustart offen: was beim Beenden in der Hauptwarteschlange stand
export interface PausedEntry {
  kind: QueueKind;
  docId: string;
  title: string;
}
export function pausedQueue(): PausedEntry[] {
  return pausedTickets().map((t) => ({ kind: t.kind, docId: t.docId, title: docTitle(t.docId) }));
}

export function discardQueue(): void {
  discardPaused();
}

// Fortsetzen: Aufträge in alter Reihenfolge neu starten; jeder macht nur, was noch fehlt
export async function resumeQueue(): Promise<number> {
  let n = 0;
  for (const t of takePaused()) {
    const p = t.params;
    const doc = db().prepare("SELECT ocr_status FROM documents WHERE id = ?").get(t.docId) as { ocr_status: string } | undefined;
    if (!doc) continue;
    if (t.kind === "docling") {
      if (doc.ocr_status === "done" || isProcessing(t.docId)) continue;
      processDocument(t.docId).catch((err) => emitLog("warn", "pipeline", "Umwandlung nach Neustart fehlgeschlagen", { err, ctx: { docId: t.docId } }));
    } else if (t.kind === "audiobook") {
      generateAudiobook({ docId: t.docId, voiceId: (p.voiceId as string) || undefined, rate: (p.rate as string) || undefined, model: (p.model as string) || undefined }).catch((err) =>
        emitLog("warn", "audiobook", "Hörbuch nach Neustart fehlgeschlagen", { err, ctx: { docId: t.docId } })
      );
    } else if (p.introOnly) startLearnIntro(t.docId, (p.rate as string) || "+0%");
    else startLearnbook(t.docId, !!p.probe, (p.rate as string) || "+0%");
    n++;
    // Die Einträge entstehen beim Start der Aufträge: kurz warten, damit die Reihenfolge bleibt
    await sleep(100);
  }
  return n;
}
