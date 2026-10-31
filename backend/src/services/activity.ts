// Warteschlange auf einen Blick: was gerade auf der Grafikkarte läuft und was wartet. Sammelt die Stände
// von Umwandlung (Docling), Stapel-Import, Lernhörbuch, Hörbuch, Hörbuch-Stapel, Wissenspflege, Begriffsnetz
// und Stimm-Engines; nur Lesen, keine eigene Steuerung
import { db } from "../db";
import { pipelineStages } from "./pipeline";
import { queueStatus } from "./batch/queue";
import { learnStates } from "./learnbook/run";
import { learnSettings } from "./learnbook/store";
import { running as audioRuns } from "./audiobook/state";
import { batchStatus } from "./batch/audiobooks";
import { maintenanceState } from "./maintenance";
import { conceptRunState } from "./concepts/extract";
import { ttsActivity, type TtsActivity } from "./ttsActivity";

export interface ActivityItem {
  kind: "docling" | "import" | "learnbook" | "audiobook" | "batch" | "maintenance" | "concepts" | "tts";
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
}

function docTitle(docId: string): string {
  const r = db().prepare("SELECT title, doc_title FROM documents WHERE id = ?").get(docId) as { title: string; doc_title: string | null } | undefined;
  return r ? r.doc_title || r.title : docId;
}

export function collectActivity(tts: TtsActivity | null = null): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const p of pipelineStages()) {
    items.push({ kind: "docling", status: p.stage === "wait" ? "waiting" : "running", step: p.stage, title: docTitle(p.docId), docId: p.docId });
  }
  const q = queueStatus();
  if (q.waiting > 0 || q.running > 0) {
    items.push({ kind: "import", status: q.running > 0 && !q.paused ? "running" : "waiting", step: q.paused ? "paused" : undefined, title: q.current ?? "", done: q.done, total: q.done + q.waiting + q.running });
  }
  for (const s of learnStates().filter((x) => x.running)) {
    items.push({
      kind: "learnbook",
      status: s.phase === "wait" || s.waiting ? "waiting" : "running",
      step: s.phase,
      title: docTitle(s.docId),
      detail: s.current,
      done: s.done,
      total: s.total,
      docId: s.docId,
      sub: s.waiting ? undefined : s.step,
      learnKind: learnSettings(s.docId).kind,
    });
  }
  for (const [docId, r] of audioRuns) {
    items.push({ kind: "audiobook", status: "running", title: docTitle(docId), done: Math.max(0, r.currentChapter - 1), total: r.totalChapters, docId });
  }
  const b = batchStatus();
  if (b && (b.status === "running" || b.status === "paused")) {
    const open = b.items.filter((i) => !["done", "failed", "canceled"].includes(i.step));
    items.push({ kind: "batch", status: b.status === "running" ? "running" : "waiting", step: b.status, title: "", done: b.items.length - open.length, total: b.items.length });
  }
  const m = maintenanceState();
  if (m.status === "running" || m.status === "countdown") {
    items.push({ kind: "maintenance", status: m.status === "running" ? "running" : "waiting", step: m.phase ?? m.status, title: m.doc ?? "", done: m.done, total: m.total });
  }
  const c = conceptRunState();
  if (c.running && m.status !== "running") items.push({ kind: "concepts", status: "running", title: c.doc ?? "", detail: c.current, done: c.done, total: c.total });
  if (tts) items.push({ kind: "tts", status: "running", step: tts.phase, title: tts.engine, detail: tts.model, done: tts.bytes, total: tts.total });
  // Laufendes zuerst, dann Wartendes
  return items.sort((a, b) => Number(a.status === "waiting") - Number(b.status === "waiting"));
}

export async function activity(): Promise<ActivityItem[]> {
  return collectActivity(await ttsActivity());
}
