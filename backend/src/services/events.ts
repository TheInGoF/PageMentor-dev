/**
 * In-memory progress bus per document for SSE streams.
 *
 * Consumers subscribe via `subscribe(docId, handler)` and receive
 * all events published through `emit(docId, event)` until they call
 * the returned unsubscribe function.
 *
 * Events are also kept in a short ring buffer per docId so a
 * late-joining client immediately sees the latest state.
 */

export type ProgressPhase =
  | "pipeline.start"
  | "pipeline.extract"
  | "pipeline.extraction"
  | "pipeline.chapters"
  | "pipeline.done"
  | "pipeline.failed"
  | "audiobook.start"
  | "audiobook.chapter.preprocess"
  | "audiobook.chapter.start"
  | "audiobook.chapter.progress"
  | "audiobook.chapter.done"
  | "audiobook.chapter.failed"
  | "audiobook.book.building"
  | "audiobook.m4b.start"
  | "audiobook.m4b.progress"
  | "audiobook.m4b.done"
  | "audiobook.done"
  | "audiobook.failed"
  | "audiobook.canceled"
  | "cards.start"
  | "cards.extract.done"
  | "cards.fill.start"
  | "cards.fill.progress"
  | "cards.fill.chapter"
  | "cards.done"
  | "cards.failed";

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
// Big enough so a SSE re-connect mid-run can still see the
// `audiobook.start` anchor (used by the UI to compute ETA and total
// chapter count). With ~5 events per chunk × ~10 chunks per chapter
// × ~10 chapters, 500 covers the realistic worst case. Each event
// is ~200 bytes → 100 KB per active run, fine.
const BUFFER = 500;

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
