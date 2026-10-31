// Warteschlange: leer ohne Arbeit; Stimm-Engine-Laden erscheint; Laufendes vor Wartendem
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

beforeAll(async () => {
  const dbm = await import("../db");
  dbm.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-activity-")), "t.db"));
  dbm.initDb();
});

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
    try {
      expect(collectActivity(null)[0]).toMatchObject({ kind: "audiobook", status: "running", done: 2, total: 5, docId: "d1" });
    } finally {
      running.delete("d1");
    }
  });
});
