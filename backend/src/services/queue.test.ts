// Hauptwarteschlange: Reihenfolge, Vorziehen, Abbruch
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { acquire, enqueueTicket, QueueCanceled, queueTickets, release, removeTicket, reorderTickets, resetQueue } from "./queue";

const settled = (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 20))]);

describe("Hauptwarteschlange", () => {
  beforeEach(() => resetQueue());
  afterAll(() => resetQueue());

  test("der Reihe nach: der Erste bekommt die Karte, der Zweite nach der Rückgabe", async () => {
    const a = enqueueTicket("docling", "d1");
    const b = enqueueTicket("audiobook", "d2", { voiceId: "v" });
    await acquire(a.id);
    const pb = acquire(b.id);
    expect(await settled(pb)).toBe(false);
    expect(queueTickets().map((t) => t.active)).toEqual([true, false]);
    // Zurückgeben allein reicht nicht: der Eintrag bleibt vorn, bis der Auftrag fertig ist
    release(a.id);
    expect(await settled(pb)).toBe(false);
    removeTicket(a.id);
    expect(await settled(pb)).toBe(true);
    expect(queueTickets().map((t) => t.active)).toEqual([true]);
  });

  test("Vorziehen: der vorgezogene Auftrag kommt dran, sobald die Karte frei ist", async () => {
    const l = enqueueTicket("learnbook", "d1");
    const a = enqueueTicket("audiobook", "d2");
    await acquire(l.id);
    const pa = acquire(a.id);
    reorderTickets([a.id, l.id]);
    // Wer die Karte hält, bleibt vorn
    expect(queueTickets().map((t) => t.id)).toEqual([l.id, a.id]);
    release(l.id);
    reorderTickets([a.id, l.id]);
    expect(queueTickets().map((t) => t.id)).toEqual([a.id, l.id]);
    expect(await settled(pa)).toBe(true);
    // Das Lernhörbuch wartet jetzt hinter dem Hörbuch
    const pl = acquire(l.id);
    expect(await settled(pl)).toBe(false);
    removeTicket(a.id);
    expect(await settled(pl)).toBe(true);
  });

  test("Entfernen und Abbruch lösen das Warten mit QueueCanceled", async () => {
    const a = enqueueTicket("docling", "d1");
    const b = enqueueTicket("docling", "d2");
    await acquire(a.id);
    const pb = acquire(b.id);
    removeTicket(b.id);
    await expect(pb).rejects.toBeInstanceOf(QueueCanceled);
    const c = enqueueTicket("docling", "d3");
    const ctrl = new AbortController();
    const pc = acquire(c.id, ctrl.signal);
    ctrl.abort();
    await expect(pc).rejects.toBeInstanceOf(QueueCanceled);
    await expect(acquire("gibt-es-nicht")).rejects.toBeInstanceOf(QueueCanceled);
  });
});
