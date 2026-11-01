// Hauptwarteschlange: Reihenfolge, Vorziehen, Abbruch
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { acquire, enqueueTicket, initQueueFile, markBatchDoc, pausedTickets, QueueCanceled, queueTickets, release, removeTicket, reorderTickets, resetQueue, takePaused } from "./queue";

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

  test("Übernahme nach Neustart: Datei lesen, Stapel-Bücher und Einzelstücke bleiben draußen", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-queue-"));
    const file = join(dir, "queue.json");
    // Beim Beenden lief d1 (live), d2 wartete (paused aus einem früheren Start), d1 doppelt zählt einmal
    writeFileSync(file, JSON.stringify({ paused: [{ kind: "learnbook", docId: "d2", params: { probe: false, rate: "+0%" }, createdAt: 1 }], live: [{ kind: "docling", docId: "d1", params: {}, createdAt: 2 }, { kind: "docling", docId: "d1", params: {}, createdAt: 3 }, { kind: "kaputt", docId: "x" }] }));
    expect(initQueueFile(dir).map((t) => `${t.kind}:${t.docId}`)).toEqual(["learnbook:d2", "docling:d1"]);
    // Neue Einträge landen als live in der Datei; Stapel-Buch und Einzelkapitel nicht
    markBatchDoc("d9", true);
    enqueueTicket("audiobook", "d3", { voiceId: "v" });
    enqueueTicket("audiobook", "d9", {});
    enqueueTicket("audiobook", "d4", { single: true });
    const saved = JSON.parse(readFileSync(file, "utf8")) as { paused: unknown[]; live: Array<{ docId: string }> };
    expect(saved.live.map((t) => t.docId)).toEqual(["d3"]);
    expect(saved.paused).toHaveLength(2);
    // Fortsetzen leert die Übernahme
    expect(takePaused()).toHaveLength(2);
    expect(pausedTickets()).toEqual([]);
    expect((JSON.parse(readFileSync(file, "utf8")) as { paused: unknown[] }).paused).toEqual([]);
  });
});
