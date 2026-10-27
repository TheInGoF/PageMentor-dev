// Import mit erfundenem Studium-Maker-Ordner; nie echte Daten
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TMP = mkdtempSync(join(tmpdir(), "pm-import-"));
const SM = join(TMP, "studium-maker");
const TRAINER_DIR = join(TMP, "daten", "trainer");

function fixture(): void {
  mkdirSync(join(SM, "30_data"), { recursive: true });
  mkdirSync(join(SM, "30_trainer"), { recursive: true });
  mkdirSync(join(SM, "20_module", "TEST1", "formeln"), { recursive: true });
  writeFileSync(
    join(SM, "studienplaner.html"),
    `<script>
  const CATALOG = [
    {g:'Grundlagen', items:[['Testmodul Eins','K',6,1,'TEST1'],['Testmodul Zwei','B',5,2,'test2']]},
    {g:'Wahlpflicht', items:[['Wahlmodul','K',5,5,'WAHL1']]}
  ];
  const EXAM_DATES_BEKANNT = ['2030-01-12', '2030-03-16', 'kaputt'];
  const TRAINER_MODULE = { TEST1: {datei: '30_trainer/test1-aufgaben.js', global: 'T1_GEN', farben: 'T1_COL', name: 'Aufgabentrainer'} };
</script>`
  );
  writeFileSync(
    join(SM, "30_data", "studium.json"),
    JSON.stringify({
      entries: [
        { id: "e1", title: "Klausur Eins", month: "2029-07", type: "klausur", status: "bestanden", date: "2029-07-14", note: "", attempt: 1, cp: 6, grade: "2,3", modul: "TEST1" },
        { id: "e2", title: "Einsendeaufgabe", month: "2030-01", type: "hausarbeit", status: "inarbeit", date: "", note: "", attempt: 1, cp: 0, grade: null, modul: "TEST2" },
        { id: "e3", title: "Heft 1", month: "2029-05", type: "studienheft", status: "bestanden", date: "", note: "", attempt: 1, cp: 0, grade: null, modul: "TEST1", heftcode: "T1-01" },
        { id: "e4", title: "Ohne Modul", month: "2030-02", type: "klausur", status: "geplant", date: "2030-03-16", attempt: 1, cp: 0, grade: null, modul: "GIBTSNICHT" },
        { title: "kaputt" },
      ],
      habits: [
        { id: "h1", date: "2029-07-01", kind: "vorbereitung", minutes: 45, module: "TEST1", note: "" },
        { id: "h2", date: "2029-07-02", kind: "geuebt", minutes: 30, module: "Sonstiges / Allgemein" },
      ],
    })
  );
  writeFileSync(
    join(SM, "30_data", "material.json"),
    JSON.stringify({
      TEST1: {
        formeln: [{ datei: "f.md", titel: "Formeln", pfad: "20_module/TEST1/formeln/f.md" }],
        merksaetze: [{ datei: "m.md", pfad: "20_module/TEST1/merksaetze/m.md" }],
        rezepte: [{ datei: "x.md", pfad: "../../ausserhalb.md" }],
      },
    })
  );
  writeFileSync(join(SM, "20_module", "TEST1", "formeln", "f.md"), "# Formeln\n\n### TEST1-F-H1-01 · Erste\nU = R I\n\n### TEST1-F-H1-02 · Zweite\nP = U I, unsicher\n");
  writeFileSync(join(SM, "30_trainer", "test1-aufgaben.js"), "window.T1_GEN = [];\n");
  mkdirSync(join(SM, "scripts"), { recursive: true });
  writeFileSync(
    join(SM, "scripts", "module_map.json"),
    JSON.stringify({
      module: {
        TEST1: { name: "Testmodul Eins", lehrheft_praefixe: ["T1H"], beleg: "Titelseite" },
        NEU9: { name: "Neues Modul", lehrheft_praefixe: ["NEUH"], beleg: null },
      },
      unbestaetigte_praefixe: { eintraege: { TEST2: ["T2X"] } },
    })
  );
}

type Mods = { db: typeof import("../../db"); run: typeof import("./run") };
let x: Mods;

beforeAll(async () => {
  fixture();
  x = { db: await import("../../db"), run: await import("./run") };
  x.db.useDatabaseFile(join(TMP, "test.db"));
  x.db.initDb();
  // Vorhandenes PageMentor-Modul ohne Kürzel wird per Name zugeordnet
  x.db.db().prepare("INSERT INTO modules (id, name) VALUES ('alt', 'Testmodul Zwei')").run();
});

const n = (sql: string) => (x.db.db().prepare(sql).get() as { n: number }).n;

describe("Studium-Maker-Import", () => {
  test("Probelauf berichtet, ändert aber nichts", () => {
    const r = x.run.runImport(SM, { dryRun: true, trainerDir: TRAINER_DIR });
    expect(r.modules).toEqual({ created: 3, updated: 1, skipped: 0 });
    expect(r.prefixes).toEqual({ created: 3, updated: 0, skipped: 0 });
    expect(r.assessments.created).toBe(4);
    expect(r.assessments.skipped).toBe(1);
    expect(r.progress.earnedCp).toBe(6);
    expect(n("SELECT COUNT(*) AS n FROM assessments")).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM modules")).toBe(1);
    expect(existsSync(TRAINER_DIR)).toBe(false);
  });

  test("Import übernimmt alles und meldet Lücken", () => {
    const r = x.run.runImport(SM, { trainerDir: TRAINER_DIR });
    expect(n("SELECT COUNT(*) AS n FROM modules")).toBe(4);
    expect(n("SELECT confirmed AS n FROM module_prefixes WHERE prefix = 'T1H'")).toBe(1);
    expect(n("SELECT confirmed AS n FROM module_prefixes WHERE prefix = 'NEUH'")).toBe(0);
    expect(n("SELECT confirmed AS n FROM module_prefixes WHERE prefix = 'T2X'")).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM modules WHERE id = 'alt' AND code = 'TEST2' AND cp = 5")).toBe(1);
    expect(n("SELECT in_path AS n FROM modules WHERE code = 'WAHL1'")).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM exam_dates")).toBe(2);
    expect(r.examDates.created).toBe(2);
    const k = x.db.db().prepare("SELECT kind, status, grade, date FROM assessments WHERE source_id = 'sm:e1'").get();
    expect(k).toEqual({ kind: "K", status: "bestanden", grade: 2.3, date: "2029-07-14" });
    const b = x.db.db().prepare("SELECT kind, status, date FROM assessments WHERE source_id = 'sm:e2'").get();
    expect(b).toEqual({ kind: "B", status: "in_arbeit", date: "2030-01" });
    expect(n("SELECT COUNT(*) AS n FROM assessments WHERE kind = 'H' AND note LIKE 'Heft T1-01%'")).toBe(1);
    expect(n("SELECT COUNT(*) AS n FROM assessments WHERE source_id = 'sm:e4' AND module_id IS NULL")).toBe(1);
    expect(r.warnings.some((w) => w.includes("GIBTSNICHT"))).toBe(true);
    expect(n("SELECT minutes AS n FROM study_time WHERE source_id = 'sm:h1'")).toBe(45);
    expect(n("SELECT COUNT(*) AS n FROM study_time WHERE source_id = 'sm:h2' AND kind = 'trainer' AND module_id IS NULL")).toBe(1);
    expect(r.material).toEqual({ created: 2, updated: 0, skipped: 2 });
    expect(n("SELECT uncertain AS n FROM material_items WHERE id = 'TEST1-F-H1-02'")).toBe(1);
    expect(r.warnings.some((w) => w.includes("ausserhalb"))).toBe(true);
    expect(existsSync(join(TRAINER_DIR, "test1-aufgaben.js"))).toBe(true);
    expect(r.progress.earnedCp).toBe(6);
    expect(r.progress.average).toBe(2.3);
  });

  test("zweiter Lauf legt nichts doppelt an", () => {
    const r = x.run.runImport(SM, { trainerDir: TRAINER_DIR });
    expect(r.assessments).toEqual({ created: 0, updated: 4, skipped: 1 });
    expect(r.modules.created).toBe(0);
    expect(r.prefixes).toEqual({ created: 0, updated: 3, skipped: 0 });
    expect(r.trainers).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(n("SELECT COUNT(*) AS n FROM assessments")).toBe(4);
    expect(n("SELECT COUNT(*) AS n FROM material_items")).toBe(2);
  });

  test("Pipeline ordnet nur mit Beleg zu", async () => {
    const { assignAfterExtraction, confirmAssignment } = await import("../assign/store");
    const ins = x.db.db().prepare("INSERT INTO documents (id, title, filename, stored_path) VALUES (?, ?, ?, '')");
    ins.run("d1", "Heft", "T1H03_Grundlagen.pdf");
    ins.run("d2", "Scan", "scan.pdf");
    ins.run("d3", "Vermutung", "T2X01.pdf");
    const md = "# Kapitel\n" + "Text mit Inhalt. ".repeat(60);
    expect(assignAfterExtraction("d1", "T1H03_Grundlagen.pdf", md, 2).assigned).toBe(true);
    expect(assignAfterExtraction("d2", "scan.pdf", md, 2).assigned).toBe(false);
    expect(assignAfterExtraction("d3", "T2X01.pdf", md + "<!-- formula-not-decoded -->", 2).assigned).toBe(false);
    const row = (id: string) => x.db.db().prepare("SELECT m.code, d.assign_confidence AS conf, d.quality_flag AS q, d.assign_module_id AS sug FROM documents d LEFT JOIN modules m ON m.id = d.module_id WHERE d.id = ?").get(id) as { code: string | null; conf: string | null; q: number; sug: string | null };
    expect(row("d1")).toMatchObject({ code: "TEST1", conf: "hoch", q: 0 });
    expect(row("d2")).toMatchObject({ code: null, conf: null });
    const d3 = row("d3");
    expect(d3).toMatchObject({ code: null, conf: "niedrig", q: 1 });
    confirmAssignment("d3", d3.sug);
    expect(row("d3")).toMatchObject({ code: "TEST2", conf: "manuell" });
    // Von Hand gesetzt bleibt beim erneuten Durchlauf
    assignAfterExtraction("d3", "T2X01.pdf", md, 2);
    expect(row("d3")).toMatchObject({ code: "TEST2", conf: "manuell" });
  });

  test("Modulkarte pflegen, gemeinsame Präfixe nur als Vorschlag", async () => {
    const { setPrefixes } = await import("../assign/store");
    const id = (x.db.db().prepare("SELECT id FROM modules WHERE code = 'TEST2'").get() as { id: string }).id;
    expect(setPrefixes(id, [{ prefix: "t2x" }, { prefix: "T2Y", confirmed: false }]).map((p) => p.prefix)).toEqual(["T2X", "T2Y"]);
    // Gemeinsamer Präfix erlaubt, Zuordnung dann nur als Vorschlag
    setPrefixes(id, [{ prefix: "T2X" }, { prefix: "T1H" }]);
    const { assignAfterExtraction } = await import("../assign/store");
    x.db.db().prepare("INSERT INTO documents (id, title, filename, stored_path) VALUES ('d4', 'x', 'T1H09.pdf', '')").run();
    const r = assignAfterExtraction("d4", "T1H09.pdf", "Text. ".repeat(200), 2);
    expect(r.assigned).toBe(false);
    expect(r.classification.rule).toContain("mehrdeutig");
    expect(() => setPrefixes(id, [{ prefix: "x y" }])).toThrow("Ungültig");
  });

  test("fehlender Ordner ist ein klarer Fehler", () => {
    expect(() => x.run.runImport(join(TMP, "gibtsnicht"))).toThrow("Ordner nicht gefunden");
  });
});
