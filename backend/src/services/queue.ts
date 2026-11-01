// Hauptwarteschlange für die Grafikkarte: Umwandlung, Hörbuch und Lernhörbuch stehen als Einträge in einer
// Reihenfolge, die der Nutzer in der Kopfzeile ändern kann. Ein Auftrag bekommt die Karte, wenn sein Eintrag ganz
// vorn steht und sie frei ist. Das Lernhörbuch gibt sie zwischen zwei Einheiten zurück: Ein vorgezogener Auftrag
// kommt dann dazwischen, danach geht es mit der nächsten Einheit weiter.
// Die Einträge liegen als Datei im Datenordner: Nach einem Neustart stehen sie als „unterbrochen“ bereit und
// laufen erst nach Bestätigung weiter (Stapel-Bücher und Einzelstücke ausgenommen)
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../paths";

export type QueueKind = "docling" | "audiobook" | "learnbook";

export interface Ticket {
  id: string;
  kind: QueueKind;
  docId: string;
  // Womit der Auftrag nach einem Neustart wieder gestartet wird
  params: Record<string, unknown>;
  createdAt: number;
  // Hält gerade die Grafikkarte
  active: boolean;
  // Vom Hörbuch-Stapel gestartet: der Stapel merkt sich seine Bücher selbst
  batch: boolean;
}

// Gespeicherter Eintrag, reicht zum Neustart des Auftrags
export interface StoredTicket {
  kind: QueueKind;
  docId: string;
  params: Record<string, unknown>;
  createdAt: number;
}

export class QueueCanceled extends Error {
  constructor() {
    super("Auftrag aus der Warteschlange genommen");
    this.name = "QueueCanceled";
  }
}

const tickets: Ticket[] = [];
let holder: string | null = null;
const waiters = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();
const listeners = new Set<() => void>();
const batchDocs = new Set<string>();
// Nach dem Neustart offen, bis Fortsetzen oder Verwerfen
let paused: StoredTicket[] = [];
let file: string | null = null;

export function markBatchDoc(docId: string, on: boolean): void {
  if (on) batchDocs.add(docId);
  else batchDocs.delete(docId);
}

// Was nach einem Neustart wieder angeboten wird
export function persistable(t: Ticket): boolean {
  return !t.batch && !t.params.single;
}

const stored = (t: Ticket): StoredTicket => ({ kind: t.kind, docId: t.docId, params: t.params, createdAt: t.createdAt });
const valid = (x: unknown): x is StoredTicket => !!x && typeof x === "object" && typeof (x as StoredTicket).docId === "string" && ["docling", "audiobook", "learnbook"].includes((x as StoredTicket).kind);

// Beim Start: Datei lesen, alles darin gilt als unterbrochen (auch, was beim Beenden gerade lief)
export function initQueueFile(dir = DATA_DIR): StoredTicket[] {
  file = join(dir, "queue.json");
  try {
    const s = JSON.parse(readFileSync(file, "utf8")) as { paused?: unknown[]; live?: unknown[] };
    const all = [...(s.paused ?? []), ...(s.live ?? [])].filter(valid);
    // Einmal je Auftrag
    paused = all.filter((t, i) => all.findIndex((o) => o.kind === t.kind && o.docId === t.docId) === i);
  } catch {
    paused = [];
  }
  save();
  return pausedTickets();
}

function save(): void {
  if (!file) return;
  try {
    writeFileSync(file, JSON.stringify({ paused, live: tickets.filter(persistable).map(stored) }, null, 2));
  } catch {
    /* Datenordner nicht beschreibbar: dann eben ohne Übernahme */
  }
}

export function pausedTickets(): StoredTicket[] {
  return paused.map((t) => ({ ...t }));
}

// Fortsetzen: die Liste herausgeben und leeren; der Aufrufer startet die Aufträge neu
export function takePaused(): StoredTicket[] {
  const out = paused;
  paused = [];
  save();
  return out;
}

export function discardPaused(): void {
  paused = [];
  save();
}

// Für Anzeige und Speicherung
export function queueTickets(): Ticket[] {
  return tickets.map((t) => ({ ...t }));
}

export function onQueueChange(fn: () => void): void {
  listeners.add(fn);
}

function changed(): void {
  save();
  for (const fn of listeners) fn();
}

// Vorn steht und frei: der Wartende bekommt die Karte
function kick(): void {
  if (holder !== null) return;
  const head = tickets[0];
  const w = head ? waiters.get(head.id) : undefined;
  if (!head || !w) return;
  waiters.delete(head.id);
  holder = head.id;
  head.active = true;
  changed();
  w.resolve();
}

export function enqueueTicket(kind: QueueKind, docId: string, params: Record<string, unknown> = {}): Ticket {
  const t: Ticket = { id: randomUUID(), kind, docId, params, createdAt: Date.now(), active: false, batch: batchDocs.has(docId) };
  tickets.push(t);
  changed();
  return t;
}

// Auf die Karte warten; wird der Eintrag vorher entfernt oder der Auftrag abgebrochen, fliegt QueueCanceled
export function acquire(id: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!tickets.some((t) => t.id === id) || signal?.aborted) return reject(new QueueCanceled());
    waiters.set(id, { resolve, reject });
    signal?.addEventListener(
      "abort",
      () => {
        if (waiters.delete(id)) reject(new QueueCanceled());
      },
      { once: true }
    );
    kick();
  });
}

// Karte zurückgeben, der Eintrag bleibt vorn, bis der Auftrag fertig ist (oder jemand vorgezogen wird)
export function release(id: string): void {
  if (holder !== id) return;
  holder = null;
  const t = tickets.find((x) => x.id === id);
  if (t) t.active = false;
  changed();
  kick();
}

// Auftrag fertig oder abgebrochen: aus der Reihe nehmen
export function removeTicket(id: string): void {
  release(id);
  const i = tickets.findIndex((t) => t.id === id);
  if (i >= 0) tickets.splice(i, 1);
  const w = waiters.get(id);
  if (w) {
    waiters.delete(id);
    w.reject(new QueueCanceled());
  }
  changed();
  kick();
}

// Neue Reihenfolge; wer die Karte hält, bleibt vorn. Unbekannte IDs behalten ihren Platz am Ende
export function reorderTickets(ids: string[]): void {
  const rank = (id: string) => {
    const i = ids.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const head = tickets.filter((t) => t.id === holder);
  const rest = tickets.filter((t) => t.id !== holder).sort((a, b) => rank(a.id) - rank(b.id));
  tickets.splice(0, tickets.length, ...head, ...rest);
  changed();
  kick();
}

// Nur für Tests
export function resetQueue(): void {
  for (const w of waiters.values()) w.reject(new QueueCanceled());
  waiters.clear();
  tickets.length = 0;
  holder = null;
  paused = [];
  batchDocs.clear();
  file = null;
}
