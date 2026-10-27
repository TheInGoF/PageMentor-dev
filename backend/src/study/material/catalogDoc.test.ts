import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

type Mods = { db: typeof import("../../db"); c: typeof import("./catalogDoc") };
let x: Mods;

beforeAll(async () => {
  x = { db: await import("../../db"), c: await import("./catalogDoc") };
  x.db.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-catalog-")), "t.db"));
  x.db.initDb();
  const d = x.db.db();
  d.prepare("INSERT INTO modules (id, name, code) VALUES ('m1', 'Testmodul', 'TEST1')").run();
  const ins = d.prepare("INSERT INTO material_items (id, module_id, kind, title, body_md, uncertain) VALUES (?, 'm1', ?, ?, ?, ?)");
  ins.run("TEST1-M-H1-01", "merksatz", "Spannung treibt Strom", "Ohne Spannung kein Strom.", 0);
  ins.run("TEST1-F-H1-01", "formel", "Ohm", "$$U = R \\cdot I$$", 0);
  ins.run("TEST1-F-H1-02", "formel", "Unklar", "$$P = ?$$", 1);
});

describe("Lernkatalog", () => {
  test("Kapitel zum Vorlesen und Karten, unsichere bleiben draußen", () => {
    const r = x.c.buildCatalog("m1", { audio: true, cards: true });
    expect(r).toEqual({ documentId: "katalog-m1", chapters: 2, cards: 2, skippedUncertain: 1 });
    const ch = x.db.db().prepare("SELECT title, audio_text FROM chapters WHERE document_id = 'katalog-m1' ORDER BY number").all() as any[];
    expect(ch.map((c) => c.title)).toEqual(["Merksätze", "Formeln"]);
    expect(ch[1].audio_text).toContain("U gleich R mal I");
  });
  test("zweiter Lauf behält den Lernstand der Karten", () => {
    x.db.db().prepare("INSERT INTO progress (id, card_id, reps) VALUES ('p1', 'card-TEST1-F-H1-01', 3)").run();
    x.c.buildCatalog("m1", { audio: true, cards: true });
    expect(x.db.db().prepare("SELECT reps FROM progress WHERE id = 'p1'").get()).toEqual({ reps: 3 });
    expect((x.db.db().prepare("SELECT COUNT(*) AS n FROM cards").get() as any).n).toBe(2);
  });
});
