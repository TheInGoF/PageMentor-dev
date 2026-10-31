// Wissenspflege: sorgt im Hintergrund dafür, dass jedes Heft vollständig erschlossen ist (Embeddings für
// Suche und Tutor, Begriffsnetz mit Gemma). Findet sie offene Arbeit und ist die Grafikkarte frei, kündigt
// sie sich mit einem Countdown an; während des Laufs meldet sie, was sie gerade wo macht. Abbrechen geht
// in beiden Phasen, danach ruht sie zwei Stunden (oder bis „Jetzt starten“)
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../db";
import { emitLog } from "../log/logger";
import { embedText, embeddingToBuffer, resolveEmbedder } from "./embeddings";
import { syncVectors } from "./rag/vec";
import { isAvailable as llmAvailable } from "./llm";
import { anyProcessing } from "./pipeline";
import { anyGenerating } from "./audiobook";
import { learnBusy } from "./learnbook/run";
import { batchStatus } from "./batch/audiobooks";
import { cancelConceptRun, conceptRunState, enqueueConcepts, openChapters } from "./concepts/extract";

const COUNTDOWN_MS = 60_000;
const SNOOZE_MS = 2 * 3600_000;
const TICK_MS = 60_000;

export interface MaintenanceOpen {
  // Abschnitte ohne passendes Embedding, in so vielen Heften
  chunks: number;
  chunkDocs: number;
  // Kapitel ohne aktuelles Begriffsnetz, in so vielen Heften
  chapters: number;
  chapterDocs: number;
}

export interface MaintenanceState {
  status: "idle" | "countdown" | "running" | "snoozed";
  // Countdown-Ende bzw. Ende der Ruhe (ms seit 1970)
  until?: number;
  open: MaintenanceOpen;
  phase?: "embeddings" | "concepts";
  doc?: string;
  detail?: string;
  done: number;
  total: number;
}

const state: MaintenanceState = { status: "idle", open: { chunks: 0, chunkDocs: 0, chapters: 0, chapterDocs: 0 }, done: 0, total: 0 };
let cancel = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function maintenanceState(): MaintenanceState {
  return { ...state, open: { ...state.open } };
}

// Andere Arbeit auf der Grafikkarte oder an Gemma: Umwandlung, Hörbuch, Stapel, Lernhörbuch, Begriffe von Hand
function busy(): boolean {
  return anyProcessing() || anyGenerating() || learnBusy() || batchStatus()?.status === "running" || (conceptRunState().running && state.status !== "running");
}

async function scanOpen(): Promise<MaintenanceOpen> {
  const embedder = await resolveEmbedder().catch(() => null);
  const emb = embedder
    ? (db()
        .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT document_id) AS d FROM chunks WHERE embedding IS NULL OR embedding_model IS NULL OR embedding_model != ?")
        .get(embedder.model) as { n: number; d: number })
    : { n: 0, d: 0 };
  // Begriffe nur zählen, wenn Gemma erreichbar ist: sonst würde der Lauf sofort scheitern
  const chapters = (await llmAvailable().catch(() => false)) ? openChapters() : [];
  return { chunks: emb.n, chunkDocs: emb.d, chapters: chapters.length, chapterDocs: new Set(chapters.map((c) => c.document_id)).size };
}

const hasWork = (o: MaintenanceOpen) => o.chunks > 0 || o.chapters > 0;

// Regelmäßig prüfen; die Entscheidung selbst ist eine reine Funktion (testbar)
export function decide(s: Pick<MaintenanceState, "status" | "until">, now: number, work: boolean, isBusy: boolean): { status: MaintenanceState["status"]; until?: number; start: boolean } {
  if (s.status === "running") return { status: "running", until: s.until, start: false };
  if (s.status === "snoozed" && s.until && now < s.until) return { status: "snoozed", until: s.until, start: false };
  if (!work) return { status: "idle", start: false };
  if (s.status === "countdown" && s.until) {
    // Wird es während des Countdowns voll, wartet der Start; die Ankündigung bleibt stehen
    if (now >= s.until && !isBusy) return { status: "running", start: true };
    return { status: "countdown", until: s.until, start: false };
  }
  return isBusy ? { status: "idle", start: false } : { status: "countdown", until: now + COUNTDOWN_MS, start: false };
}

async function tick(): Promise<void> {
  if (state.status === "running") return;
  if (state.status !== "countdown") state.open = await scanOpen();
  const d = decide(state, Date.now(), hasWork(state.open), busy());
  state.status = d.status;
  state.until = d.until;
  if (d.start) void runNow();
}

export function startMaintenance(): void {
  if (timer || process.env.PM_MAINTENANCE === "0") return;
  timer = setInterval(() => void tick().catch(() => undefined), TICK_MS);
  timer.unref?.();
  // Erster Blick kurz nach dem Start, wenn die Engine hochgefahren ist
  setTimeout(() => void tick().catch(() => undefined), 20_000).unref?.();
}

// Sofort starten (Knopf „Jetzt starten“), auch aus der Ruhe heraus
export async function startNow(): Promise<MaintenanceState> {
  if (state.status === "running") return maintenanceState();
  state.open = await scanOpen();
  if (!hasWork(state.open)) {
    Object.assign(state, { status: "idle", until: undefined });
    return maintenanceState();
  }
  void runNow();
  return maintenanceState();
}

// Abbrechen: im Countdown oder mitten im Lauf; danach Ruhe
export function cancelMaintenance(): MaintenanceState {
  if (state.status === "running") {
    cancel = true;
    cancelConceptRun();
  }
  Object.assign(state, { status: "snoozed", until: Date.now() + SNOOZE_MS, phase: undefined, doc: undefined, detail: undefined });
  return maintenanceState();
}

async function runNow(): Promise<void> {
  cancel = false;
  Object.assign(state, { status: "running", until: undefined, done: 0, total: 0 });
  try {
    await embeddings();
    if (!cancel) await concepts();
    if (!cancel) {
      emitLog("info", "maintenance", "Wissenspflege fertig: alle Hefte erschlossen");
      Object.assign(state, { status: "idle", phase: undefined, doc: undefined, detail: undefined });
    }
  } catch (err) {
    emitLog("warn", "maintenance", "Wissenspflege unterbrochen", { err });
    Object.assign(state, { status: "snoozed", until: Date.now() + SNOOZE_MS });
  }
  state.open = await scanOpen().catch(() => state.open);
  // Bleibt nach einem vollen Lauf etwas offen (z. B. Gemma antwortete nicht), nicht gleich wieder anfangen
  if (state.status === "idle" && hasWork(state.open)) Object.assign(state, { status: "snoozed", until: Date.now() + SNOOZE_MS });
}

// Fehlende Embeddings Heft für Heft; danach den Vektorindex nachziehen
async function embeddings(): Promise<void> {
  const embedder = await resolveEmbedder().catch(() => null);
  if (!embedder) return;
  const rows = db()
    .prepare(
      `SELECT c.id, c.text, c.document_id, d.title FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE c.embedding IS NULL OR c.embedding_model IS NULL OR c.embedding_model != ? ORDER BY c.document_id, c.chunk_index`
    )
    .all(embedder.model) as Array<{ id: string; text: string; document_id: string; title: string }>;
  if (!rows.length) return;
  Object.assign(state, { phase: "embeddings", done: 0, total: rows.length });
  const update = db().prepare("UPDATE chunks SET embedding = ?, embedding_model = ? WHERE id = ?");
  for (const r of rows) {
    if (cancel) return;
    // Embeddings laufen im eigenen Dienst; trotzdem einer Umwandlung oder einem Hörbuch den Vortritt lassen
    while (!cancel && (anyProcessing() || anyGenerating())) await sleep(5000);
    state.doc = r.title;
    state.detail = `Abschnitt ${state.done + 1} von ${rows.length}`;
    try {
      update.run(embeddingToBuffer(await embedText(r.text, embedder, "passage")), embedder.model, r.id);
    } catch {
      // einzelner Fehler: beim nächsten Durchgang wieder offen
    }
    state.done++;
  }
  syncVectors(db());
}

// Begriffsnetz über die vorhandene Warteschlange; Fortschritt von dort übernehmen
async function concepts(): Promise<void> {
  const docs = [...new Set(openChapters().map((c) => c.document_id))];
  if (!docs.length || !(await llmAvailable().catch(() => false))) return;
  state.phase = "concepts";
  enqueueConcepts(docs);
  for (let c = conceptRunState(); c.running && !cancel; c = conceptRunState()) {
    Object.assign(state, { doc: c.doc, detail: c.current ? `Kapitel „${c.current}“` : undefined, done: c.done, total: c.total });
    await sleep(2000);
  }
}
