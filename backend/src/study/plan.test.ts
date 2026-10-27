// Prüfungstermine und Nachrücken mit erfundenen Daten
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { examSlots, planShift } from "./plan";
import type { Assessment } from "./assessments";

const A = (id: string, date: string, status = "geplant", kind = "K"): Assessment =>
  ({ id, title: id, date, status, kind, module_id: null, attempt: 1, cp: 0, grade: null, note: null } as unknown as Assessment);

describe("examSlots", () => {
  test("bekannte Termine plus fortgeschriebene Samstage", () => {
    const s = examSlots(["2030-01-12", "2030-03-16", "2029-11-17"], 2031);
    expect(s.filter((x) => !x.estimate).map((x) => x.date)).toEqual(["2029-11-17", "2030-01-12", "2030-03-16"]);
    const est = s.filter((x) => x.estimate);
    expect(est).toHaveLength(2);
    for (const e of est) {
      expect(e.date.startsWith("2031")).toBe(true);
      expect(new Date(e.date + "T00:00:00Z").getUTCDay()).toBe(6);
    }
  });
  test("leer bleibt leer", () => expect(examSlots([], 2040)).toEqual([]));
});

describe("planShift", () => {
  const slots = ["2030-01-12", "2030-03-16", "2030-05-18", "2030-07-13"].map((date) => ({ date, estimate: date > "2030-05-01" }));
  test("geplante Klausuren rücken nach, angemeldete bleiben", () => {
    const all = [A("a", "2030-01-12"), A("b", "2030-03-16"), A("c", "2030-05-18", "angemeldet"), A("h", "2030-03-16", "geplant", "H")];
    const r = planShift(all, "a", slots);
    expect(r.steps.map((s) => [s.id, s.to])).toEqual([["a", "2030-03-16"], ["b", "2030-05-18"]]);
    expect(r.steps[1].estimate).toBe(true);
    expect(r.warnings[0]).toContain("„c“");
  });
  test("kein späterer Termin oder kein Datum: klare Meldung", () => {
    expect(() => planShift([A("z", "2030-07-13")], "z", slots)).toThrow("Kein weiterer");
    expect(() => planShift([A("m", "2030-07")], "m", slots)).toThrow("kein Prüfungsdatum");
  });
});

describe("Wiederholung", () => {
  type Mods = { db: typeof import("../db"); a: typeof import("./assessments") };
  let x: Mods;
  beforeAll(async () => {
    x = { db: await import("../db"), a: await import("./assessments") };
    x.db.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-plan-")), "t.db"));
    x.db.initDb();
  });
  test("höchstens drei Versuche, kein doppelter Folgeversuch", () => {
    const first = x.a.createAssessment({ title: "Mathe", status: "nicht_bestanden" });
    const second = x.a.scheduleRetry(first.id);
    expect(x.a.scheduleRetry(first.id).id).toBe(second.id);
    const third = x.a.scheduleRetry(x.a.updateAssessment(second.id, { status: "nicht_bestanden" }).id);
    expect(third.attempt).toBe(3);
    x.a.updateAssessment(third.id, { status: "nicht_bestanden" });
    expect(() => x.a.scheduleRetry(third.id)).toThrow("keine weiteren Versuche");
  });
});
