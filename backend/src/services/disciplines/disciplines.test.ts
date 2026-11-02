import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DISCIPLINES, FAMILIES, disciplineColor, taxonomy } from "./taxonomy";

let dbm: typeof import("../../db");

beforeAll(async () => {
  dbm = await import("../../db");
  dbm.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-disc-")), "t.db"));
  dbm.initDb();
  dbm.db().prepare("INSERT INTO modules (id, name, color) VALUES ('m1', 'Regelungstechnik', '#3b82f6'), ('m2', 'Spanisch', '#22c55e')").run();
  // wie die Migration: bisherige eigene Farben gelten als gewählt
  dbm.db().prepare("UPDATE modules SET color_custom = 1 WHERE id = 'm2'").run();
});

describe("Wissenschaften", () => {
  test("jede Wissenschaft hat eine Familie und eine eigene Farbe, Verwandte im selben Farbraum", () => {
    for (const d of DISCIPLINES) expect(FAMILIES.some((f) => f.id === d.family)).toBe(true);
    const colors = taxonomy().disciplines.map((d) => d.color);
    expect(colors.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    expect(new Set(colors.filter((c, i) => DISCIPLINES[i].family !== "other")).size).toBe(colors.length - 1);
    expect(disciplineColor("auto.control")).not.toBe(disciplineColor("auto.plc"));
  });

  test("Antwort lesen: nur IDs aus der Liste", async () => {
    const { parseDiscipline } = await import("./classify");
    expect(parseDiscipline('{"fach":"auto.control"}')).toBe("auto.control");
    expect(parseDiscipline('{"fach":"astrologie"}')).toBeNull();
    expect(parseDiscipline("kaputt")).toBeNull();
  });

  test("Farbe folgt der Wissenschaft, eigene Farbe bleibt", async () => {
    const { setDiscipline, openModules } = await import("./classify");
    expect(openModules().map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    setDiscipline("m1", "auto.control", "ai");
    setDiscipline("m2", "lang.spanish", "ai");
    const rows = dbm.db().prepare("SELECT id, color, discipline_by FROM modules ORDER BY id").all() as Array<{ id: string; color: string; discipline_by: string }>;
    expect(rows[0].color).toBe(disciplineColor("auto.control")!);
    // Grün war schon vor der Wissenschaft eigens gewählt
    expect(rows[1].color).toBe("#22c55e");
    expect(openModules()).toEqual([]);
  });
});
