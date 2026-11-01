// Verbindungen sichern und Netz aufräumen
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { confirmLinks, wordTitle, type Explains, type RawLink } from "./links";

const link = (a: string, b: string, chapter: string, doc = "d1", pos = 2): RawLink => ({ a, b, chapter, doc, pos });
const explains: Explains = new Map([
  ["Entropie", new Map([["d1", 1]])],
  ["Code", new Map([["d1", 2]])],
  ["Codierung", new Map([["d1", 2]])],
  ["Wahrscheinlichkeit", new Map([["d2", 1]])],
  ["Kanalkapazität", new Map([["d1", 3]])],
]);

describe("Verbindungen sichern", () => {
  test("zwei Kapitel, Grundlage vorher erklärt, Grundlage aus anderem Heft", () => {
    const sure = confirmLinks([link("Huffman", "Entropie", "c2"), link("X", "Y", "c1"), link("X", "Y", "c3"), link("Entropie", "Wahrscheinlichkeit", "c1", "d1", 1)], explains);
    expect([...sure].sort()).toEqual(["Entropie|Wahrscheinlichkeit", "Huffman|Entropie", "X|Y"]);
  });

  test("Vorgriff und unbekannte Grundlage sind ungesichert", () => {
    const sure = confirmLinks([link("Entropie", "Kanalkapazität", "c1", "d1", 1), link("Entropie", "Nirgends", "c1")], explains);
    expect(sure.size).toBe(0);
  });

  test("gegenseitiges Paar: die Richtung zur früher erklärten Grundlage bleibt, bei Gleichstand keine", () => {
    const sure = confirmLinks([link("Code", "Entropie", "c2"), link("Entropie", "Code", "c2"), link("Code", "Codierung", "c2"), link("Codierung", "Code", "c2")], explains);
    expect([...sure]).toEqual(["Code|Entropie"]);
  });

  test("Wort-Titel", () => {
    expect(wordTitle("1111 1110.")).toBe(false);
    expect(wordTitle("3 Kanalcodierung")).toBe(true);
    expect(wordTitle(null)).toBe(false);
  });
});

describe("Aufräumen", () => {
  beforeAll(async () => {
    const dbm = await import("../../db");
    dbm.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-links-")), "t.db"));
    dbm.initDb();
    const d = dbm.db();
    d.prepare("INSERT INTO documents (id, title, filename, stored_path, second_language) VALUES ('d1', 'Codierung', 'a.pdf', '', NULL), ('d2', 'Spanisch', 'b.pdf', '', 'es')").run();
    d.prepare(
      "INSERT INTO chapters (id, document_id, number, title, kind, text) VALUES ('c1', 'd1', 1, 'Einführung', 'content', 'x'), ('c2', 'd1', 2, '1111 1110.', 'content', 'x'), ('c3', 'd2', 1, 'Quién es', 'content', 'y')"
    ).run();
    const { saveChapterConcepts } = await import("./store");
    saveChapterConcepts("c1", "d1", [{ name: "Codierung", definition: "Darstellung", explains: true, needs: [] }], "s");
    saveChapterConcepts("c2", "d1", [{ name: "Paketkopf", definition: "", explains: true, needs: ["Byte"] }], "s");
    saveChapterConcepts("c3", "d2", [{ name: "amiga", definition: "Freundin", explains: true, needs: [] }], "s");
  });

  test("Aufgabenfetzen und Sprachheft fallen weg, der Rest bleibt", async () => {
    const { cleanupConcepts, linkStatus } = await import("./links");
    const { db } = await import("../../db");
    expect(cleanupConcepts()).toEqual({ chapters: 2, concepts: 3 });
    expect((db().prepare("SELECT name FROM concepts ORDER BY name").all() as Array<{ name: string }>).map((c) => c.name)).toEqual(["Codierung"]);
    expect(linkStatus().size).toBe(0);
  });

  test("Tutor folgt nur gesicherten Verbindungen", async () => {
    const { saveChapterConcepts } = await import("./store");
    const { activate } = await import("./activate");
    const { db } = await import("../../db");
    saveChapterConcepts("c1", "d1", [{ name: "Codierung", definition: "Darstellung", explains: true, needs: ["Kanal"] }], "s");
    // Kanal wird nirgends erklärt: ungesichert, keine Ausbreitung
    expect(activate(null, ["c1"]).map((a) => a.name)).toEqual(["Codierung"]);
    db().prepare("INSERT INTO chapters (id, document_id, number, title, kind, text) VALUES ('c0', 'd1', 0, 'Grundlagen', 'content', 'x')").run();
    saveChapterConcepts("c0", "d1", [{ name: "Kanal", definition: "Weg", explains: true, needs: [] }], "s");
    expect(activate(null, ["c1"]).map((a) => `${a.name}:${a.depth}`)).toEqual(["Codierung:0", "Kanal:1"]);
  });

  test("Kapitel hervorheben: Begriffe des Kapitels und Grundlagen", async () => {
    const { chapterActivation } = await import("./activate");
    expect(chapterActivation("c1").map((a) => `${a.name}:${a.depth}:${a.strength}`)).toEqual(["Codierung:0:1", "Kanal:1:0.5"]);
    expect(chapterActivation("nirgends")).toEqual([]);
  });
});
