import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

type Mods = { db: typeof import("../db"); f: typeof import("./focus") };
let x: Mods;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  x = { db: await import("../db"), f: await import("./focus") };
  x.db.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-focus-")), "t.db"));
  x.db.initDb();
});

describe("examFocus", () => {
  test("ohne Prüfung nichts zu tun", () => {
    expect(x.f.examFocus()).toEqual({ exam: null, todo: [], minutes7: 0 });
  });
  test("offene Punkte des Prüfungsmoduls in fester Reihenfolge", () => {
    const d = x.db.db();
    d.prepare("INSERT INTO modules (id, name, code) VALUES ('m1', 'Test', 'TEST1')").run();
    d.prepare("INSERT INTO assessments (id, module_id, kind, title, date, status) VALUES ('a1', 'm1', 'K', 'Klausur', ?, 'angemeldet')").run(inDays(12));
    d.prepare("INSERT INTO documents (id, title, filename, stored_path, module_id, ocr_status) VALUES ('d1', 'Heft', 'h.pdf', '', 'm1', 'done')").run();
    d.prepare("INSERT INTO cards (id, document_id, question) VALUES ('c1', 'd1', 'Frage')").run();
    d.prepare("INSERT INTO material_items (id, module_id, kind, uncertain) VALUES ('TEST1-M-X-01', 'm1', 'merksatz', 1)").run();
    const f = x.f.examFocus();
    expect(f.exam).toMatchObject({ moduleCode: "TEST1", days: 12 });
    expect(f.todo.map((t) => [t.key, t.count])).toEqual([["uncertain", 1], ["dueCards", 1], ["noMaterial", 1], ["noTime", 0]]);
  });
});
