// Hauptwarteschlange für die Grafikkarte: Umwandlung, Hörbuch und Lernhörbuch stehen als Einträge in einer
// Reihenfolge, die der Nutzer in der Kopfzeile ändern kann. Ein Auftrag bekommt die Karte, wenn sein Eintrag ganz
// vorn steht und sie frei ist. Das Lernhörbuch gibt sie zwischen zwei Einheiten zurück: Ein vorgezogener Auftrag
// kommt dann dazwischen, danach geht es mit der nächsten Einheit weiter
import { randomUUID } from "node:crypto";

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

// Für Anzeige und Speicherung
export function queueTickets(): Ticket[] {
  return tickets.map((t) => ({ ...t }));
}

export function onQueueChange(fn: () => void): void {
  listeners.add(fn);
}

function changed(): void {
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
  const t: Ticket = { id: randomUUID(), kind, docId, params, createdAt: Date.now(), active: false };
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
}
