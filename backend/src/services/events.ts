/**
 * In-memory Progress-Bus pro Dokument für SSE-Streams.
 *
 * Konsumenten abonnieren per `subscribe(docId, handler)` und erhalten
 * alle Events, die via `emit(docId, event)` veröffentlicht werden, bis
 * sie mit dem zurückgegebenen Unsubscribe-Funktion aufhören.
 *
 * Events werden außerdem in einem kurzen Ring-Buffer pro docId gehalten,
 * damit ein später verbundener Client den letzten Stand sofort sieht.
 */

export type ProgressPhase =
  | "pipeline.start"
  | "pipeline.extract"
  | "pipeline.chapters"
  | "pipeline.done"
  | "pipeline.failed"
  | "audiobook.start"
  | "audiobook.chapter.start"
  | "audiobook.chapter.progress"
  | "audiobook.chapter.done"
  | "audiobook.chapter.failed"
  | "audiobook.book.building"
  | "audiobook.done"
  | "audiobook.failed";

export interface ProgressEvent {
  phase: ProgressPhase;
  docId: string;
  chapterId?: string;
  chapterNumber?: number;
  total?: number;
  current?: number;
  message?: string;
  ts: number;
}

type Handler = (ev: ProgressEvent) => void;

const subs = new Map<string, Set<Handler>>();
const recent = new Map<string, ProgressEvent[]>();
const BUFFER = 50;

export function emit(ev: Omit<ProgressEvent, "ts"> & { ts?: number }): void {
  const full: ProgressEvent = { ts: Date.now(), ...ev } as ProgressEvent;
  const buf = recent.get(full.docId) ?? [];
  buf.push(full);
  if (buf.length > BUFFER) buf.shift();
  recent.set(full.docId, buf);

  const handlers = subs.get(full.docId);
  if (handlers) for (const h of handlers) h(full);
}

export function subscribe(docId: string, handler: Handler): () => void {
  let set = subs.get(docId);
  if (!set) {
    set = new Set();
    subs.set(docId, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
    if (set!.size === 0) subs.delete(docId);
  };
}

export function getRecent(docId: string): ProgressEvent[] {
  return recent.get(docId) ?? [];
}
