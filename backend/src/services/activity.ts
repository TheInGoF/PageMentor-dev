// Warteschlange auf einen Blick: vorn die Einträge der Hauptwarteschlange (Umwandlung, Hörbuch, Lernhörbuch) in
// ihrer Reihenfolge, verschiebbar und entfernbar; dahinter Stapel-Import, Hörbuch-Stapel, Wissenspflege,
// Begriffsnetz und Stimm-Engines, nur zum Lesen
import { db } from "../db";
import { cancelProcessing, pipelineStages } from "./pipeline";
import { queueStatus } from "./batch/queue";
import { cancelLearnbook, learnStates } from "./learnbook/run";
import { learnSettings } from "./learnbook/store";
import { cancelAudiobook, running as audioRuns } from "./audiobook/state";
import { queueTickets, removeTicket, reorderTickets, type Ticket } from "./queue";
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
