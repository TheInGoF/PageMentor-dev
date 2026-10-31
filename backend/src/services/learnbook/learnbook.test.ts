// Lernhörbuch: Einheiten bilden, Wiederholung in Abständen, Speicher behält Unverändertes
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { reviewPoints, splitUnits } from "./script";
import type { LearnUnit } from "./store";

let dbm: typeof import("../../db");

beforeAll(async () => {
  dbm = await import("../../db");
  dbm.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-learn-")), "t.db"));
  dbm.initDb();
  const d = dbm.db();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path, second_language) VALUES ('d1', 'Spanisch', 'a.pdf', '', 'es'), ('d2', 'Information', 'b.pdf', '', NULL)").run();
  const ins = d.prepare("INSERT INTO chapters (id, document_id, number, title, kind, text, start_page, end_page, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  ins.run("c1", "d2", 1, "Einführung", "content", "a".repeat(3000) + "\n\n" + "b".repeat(3000), 9, 12, 0);
  ins.run("c2", "d2", 2, "Literatur", "references", "Quelle 1, Quelle 2, Quelle 3", 13, 13, 1);
  ins.run("c3", "d2", 3, "Entropie", "content", "c".repeat(4000), 14, 20, 2);
});

const p = (text: string, page: number, heading = false) => ({ text, page, heading });

describe("Einheiten", () => {
  test("an Überschriften geschlossen, nie über das 1,6-fache, kleiner Rest hängt an", () => {
    const units = splitUnits([p("Kapitel 1", 1, true), p("x".repeat(700), 1), p("y".repeat(400), 2), p("Kapitel 2", 3, true), p("z".repeat(900), 3), p("r".repeat(100), 4)], 1000);
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ start_page: 1, end_page: 2 });
    expect(units[0].source.startsWith("## Kapitel 1")).toBe(true);
    expect(units[1].source).toContain("r".repeat(100));
    const big = splitUnits([p("w".repeat(900), 1), p("v".repeat(900), 2), p("u".repeat(900), 3)], 1000);
    expect(big.every((u) => u.source.length <= 1600 + 4)).toBe(true);
  });

  test("Literatur und Verzeichnisse fallen weg, Seiten bleiben erhalten", async () => {
    const { unitsFor } = await import("./script");
    const units = unitsFor("d2", "subject");
    expect(units.map((u) => u.source).join()).not.toContain("Quelle 1");
    expect(units[0].start_page).toBe(9);
    expect(units[units.length - 1].end_page).toBeGreaterThanOrEqual(14);
  });

  test("Wiederholung aus 1, 3 und 7 Einheiten zurück, ohne Doppelte", () => {
    const u = (idx: number, points: string[]) => ({ idx, points: JSON.stringify(points) }) as LearnUnit;
    const units = [u(0, ["hola = hallo"]), u(1, ["a"]), u(2, ["b"]), u(3, ["c", "hola = hallo"]), u(4, ["d"])];
    expect(reviewPoints(units, 4)).toEqual(["c", "hola = hallo", "a"]);
    expect(reviewPoints(units, 0)).toEqual([]);
  });
});

describe("Speicher", () => {
  test("Art aus dem Heft geschätzt: zweite Sprache = Sprachkurs", async () => {
    const { learnSettings } = await import("./store");
    expect(learnSettings("d1")).toEqual({ kind: "language", lang: "es" });
    expect(learnSettings("d2").kind).toBe("subject");
  });

  test("gleiche Quelle behält Skript, geänderte wird neu, überzählige fallen weg", async () => {
    const { syncUnits, saveScript, listUnits } = await import("./store");
    syncUnits("d2", [{ source: "A", start_page: 1, end_page: 1 }, { source: "B", start_page: 2, end_page: 2 }, { source: "C", start_page: 3, end_page: 3 }]);
    saveScript("d2", 0, { title: "T0", script: "S0", points: ["p"], checkNote: null, model: "m", stamp: "s" });
    saveScript("d2", 1, { title: "T1", script: "S1", points: [], checkNote: null, model: "m", stamp: "s" });
    syncUnits("d2", [{ source: "A", start_page: 1, end_page: 1 }, { source: "B2", start_page: 2, end_page: 2 }]);
    const units = listUnits("d2");
    expect(units).toHaveLength(2);
    expect(units[0].script).toBe("S0");
    expect(units[1].script).toBeNull();
  });
});
