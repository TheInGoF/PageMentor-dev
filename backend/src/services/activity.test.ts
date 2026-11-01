// Warteschlange: leer ohne Arbeit; Stimm-Engine-Laden erscheint; Hauptwarteschlange in Reihenfolge, verschiebbar
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { acquire, enqueueTicket, queueTickets, resetQueue } from "./queue";

beforeAll(async () => {
  const dbm = await import("../db");
  dbm.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-activity-")), "t.db"));
  dbm.initDb();
});
beforeEach(() => resetQueue());

describe("Warteschlange", () => {
  test("ohne Arbeit leer, Engine-Laden als laufend", async () => {
    const { collectActivity } = await import("./activity");
    expect(collectActivity(null)).toEqual([]);
    const items = collectActivity({ engine: "f5", phase: "download", model: "F5 Spanish", seconds: 3, bytes: 5, total: 10 });
    expect(items).toEqual([{ kind: "tts", status: "running", step: "download", title: "f5", detail: "F5 Spanish", done: 5, total: 10 }]);
  });

  test("Hörbuch im Lauf erscheint mit Kapitelstand", async () => {
    const { collectActivity } = await import("./activity");
    const { running } = await import("./audiobook/state");
    running.set("d1", { ctrl: new AbortController(), startedAt: 0, totalChapters: 5, currentChapter: 3, chunkCurrent: 0, chunkTotal: 0, chapterChars: [] });
    const tk = enqueueTicket("audiobook", "d1", {});
    await acquire(tk.id);
    try {
      expect(collectActivity(null)[0]).toMatchObject({ kind: "audiobook", status: "running", done: 2, total: 5, docId: "d1", ticket: tk.id, movable: false });
    } finally {
      running.delete("d1");
    }
  });

  test("Hauptwarteschlange in Reihenfolge: Wartende verschiebbar, Entfernen bricht ab", async () => {
    const { collectActivity, removeQueueEntry, reorderQueue } = await import("./activity");
    const a = enqueueTicket("docling", "d1");
    const b = enqueueTicket("audiobook", "d2", { single: true, intro: true });
    const c = enqueueTicket("audiobook", "d3");
    await acquire(a.id);
    const items = collectActivity(null);
    expect(items.map((i) => [i.kind, i.status, i.movable])).toEqual([
      ["docling", "running", false],
      ["audiobook", "waiting", true],
      ["audiobook", "waiting", true],
    ]);
    expect(items[1].sub).toBe("intro");
    // Hörbuch vor die Umwandlung ziehen geht nicht, die hält die Karte; untereinander schon
    reorderQueue([c.id, b.id, a.id]);
    expect(queueTickets().map((t) => t.id)).toEqual([a.id, c.id, b.id]);
    expect(removeQueueEntry(b.id)).toBe(true);
    expect(removeQueueEntry("gibt-es-nicht")).toBe(false);
    expect(collectActivity(null).map((i) => i.docId)).toEqual(["d1", "d3"]);
  });
});
