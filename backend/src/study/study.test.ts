// Studien-Datenmodell mit erfundenen Daten in einem leeren Datenordner
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TMP = mkdtempSync(join(tmpdir(), "pm-study-"));

type Mods = {
  db: typeof import("../db");
  a: typeof import("./assessments");
  p: typeof import("./progress");
  t: typeof import("./time");
  m: typeof import("./material");
};
let x: Mods;

beforeAll(async () => {
  x = {
    db: await import("../db"),
    a: await import("./assessments"),
    p: await import("./progress"),
    t: await import("./time"),
    m: await import("./material"),
  };
  // Nie die echte Datenbank: eigene Datei im Temp-Ordner
  x.db.useDatabaseFile(join(TMP, "test.db"));
  x.db.initDb();
  const ins = x.db.db().prepare("INSERT INTO modules (id, name, code, cp) VALUES (?, ?, ?, ?)");
  ins.run("m1", "Testmodul Eins", "TEST1", 6);
  ins.run("m2", "Testmodul Zwei", "TEST2", 8);
});

describe("Schema", () => {
  test("Version gesetzt, zweiter Lauf ändert nichts", async () => {
    const { migrateStudy, STUDY_SCHEMA_VERSION } = await import("./schema");
    const r = migrateStudy(x.db.db(), join(TMP, "test.db"));
    expect(r.version).toBe(STUDY_SCHEMA_VERSION);
    expect(r.backup).toBeNull();
  });
  test("Backup vor Hochstufung, wenn Daten da sind", async () => {
    const { migrateStudy } = await import("./schema");
    const d = x.db.db();
    d.prepare("INSERT INTO documents (id, title, filename, stored_path) VALUES ('d1', 'Doc', 'a.pdf', 'x')").run();
    d.exec("PRAGMA user_version = 0");
    const r = migrateStudy(d, join(TMP, "test.db"));
    expect(r.backup).toContain("backups");
    d.prepare("DELETE FROM documents WHERE id = 'd1'").run();
  });
  test("Kürzel eindeutig", () => {
    expect(() => x.db.db().prepare("INSERT INTO modules (id, name, code) VALUES ('m3', 'Doppelt', 'TEST1')").run()).toThrow();
  });
});

describe("Leistungen und Fortschritt", () => {
  test("Eingaben werden geprüft", () => {
    expect(() => x.a.createAssessment({ title: "X", date: "12.09.2026" })).toThrow(x.a.StudyInputError);
    expect(() => x.a.createAssessment({ title: "X", grade: 6 })).toThrow(x.a.StudyInputError);
    expect(() => x.a.createAssessment({ title: " " })).toThrow(x.a.StudyInputError);
  });

  test("CP-gewichteter Schnitt und CP je Modul einmal", () => {
    x.a.createAssessment({ title: "Eins", module_id: "m1", status: "bestanden", grade: 2.0 });
    x.a.createAssessment({ title: "Zwei", module_id: "m2", status: "bestanden", grade: 3.0, cp: 8 });
    const failed = x.a.createAssessment({ title: "Eins alt", module_id: "m1", status: "nicht_bestanden", grade: 5.0 });
    const p = x.p.studyProgress();
    expect(p.earnedCp).toBe(14);
    // (2,0·6 + 3,0·8) / 14
    expect(p.average).toBeCloseTo(2.57, 2);
    expect(p.passedModules).toBe(2);
    const retry = x.a.scheduleRetry(failed.id);
    expect(retry.attempt).toBe(2);
    expect(retry.status).toBe("geplant");
  });

  test("Nächste Prüfung mit Tagen", () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    x.a.createAssessment({ title: "Bald", module_id: "m2", date: soon, status: "angemeldet" });
    x.a.createAssessment({ title: "Nur Monat", date: "2099-01", status: "geplant" });
    const n = x.p.studyProgress().nextExam!;
    expect(n.title).toBe("Bald");
    expect(n.module_code).toBe("TEST2");
    expect(n.days).toBe(10);
  });
});

describe("Lernzeit", () => {
  test("Summen je Tag und Modul, Grenzen geprüft", () => {
    x.t.addTime({ date: "2026-01-05", module_id: "m1", kind: "trainer", minutes: 30 });
    x.t.addTime({ date: "2026-01-05", module_id: "m2", kind: "lernen", minutes: 45 });
    x.t.addTime({ date: "2026-01-06", module_id: "m1", kind: "karten", minutes: 15 });
    expect(x.t.minutesPerDay("2026-01-01", "2026-01-31")).toEqual([
      { date: "2026-01-05", minutes: 75 },
      { date: "2026-01-06", minutes: 15 },
    ]);
    expect(x.t.minutesPerModule("2026-01-01", "2026-01-31")).toContainEqual({ module_id: "m1", minutes: 45 });
    expect(() => x.t.addTime({ date: "2026-01-07", module_id: null, kind: "lernen", minutes: 0 })).toThrow();
    expect(() => x.t.addTime({ date: "2026-01-07", module_id: null, kind: "schlafen" as never, minutes: 5 })).toThrow();
  });
});

describe("Material", () => {
  test("Grep-ID, Upsert, unsicher erkannt", () => {
    x.m.upsertMaterial({ id: "TEST1-F-H1-01", module_id: "m1", kind: "formel", title: "Ohm", body_md: "U = R · I" });
    x.m.upsertMaterial({ id: "TEST1-M-H1-01", module_id: "m1", kind: "merksatz", title: "Merke", body_md: "Vorzeichen unsicher" });
    x.m.upsertMaterial({ id: "TEST1-F-H1-01", module_id: "m1", kind: "formel", title: "Ohmsches Gesetz", body_md: "U = R · I" });
    const c = x.m.materialCounts("m1");
    expect(c.formel).toBe(1);
    expect(c.merksatz).toBe(1);
    expect(c.uncertain).toBe(1);
    expect(x.m.getMaterial("TEST1-F-H1-01")!.title).toBe("Ohmsches Gesetz");
    expect(x.m.uncertainItems().map((i) => i.id)).toEqual(["TEST1-M-H1-01"]);
    x.m.setUncertain("TEST1-M-H1-01", false);
    expect(x.m.uncertainItems()).toHaveLength(0);
    expect(() => x.m.upsertMaterial({ id: "kleine id", module_id: "m1", kind: "formel", title: "", body_md: "" })).toThrow();
  });
});
