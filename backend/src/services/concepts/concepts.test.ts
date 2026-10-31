// Begriffsnetz: Normalisierung, Zusammenführen, Speichern und Ausbreitung über mehrere Ebenen
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { normalizeConcept } from "./store";
import { spread, conceptNetText } from "./activate";

let dbm: typeof import("../../db");

beforeAll(async () => {
  dbm = await import("../../db");
  dbm.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-concepts-")), "t.db"));
  dbm.initDb();
  const d = dbm.db();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path) VALUES ('d1', 'Information', 'a.pdf', ''), ('d2', 'DSIV 1', 'b.pdf', '')").run();
  d.prepare("INSERT INTO chapters (id, document_id, number, title, kind, text) VALUES ('c1', 'd1', 3, 'Kanäle', 'content', 'x'), ('c2', 'd2', 5, 'Entropie', 'content', 'y')").run();
});

describe("Begriffe", () => {
  test("Schreibweisen fallen zusammen", () => {
    expect(normalizeConcept("Codewörter")).toBe(normalizeConcept("Codewort"));
    expect(normalizeConcept("Kanal-Kapazität")).toBe(normalizeConcept("Kanalkapazität"));
    expect(normalizeConcept("Bus")).not.toBe(normalizeConcept("Bu"));
  });

  test("Antwort lesen und Stücke zusammenführen", async () => {
    const { parseConcepts, mergeConcepts } = await import("./extract");
    const a = parseConcepts('{"begriffe":[{"name":"Entropie","erklaerung":"Mittlerer Informationsgehalt","erklaert":false,"baut_auf":["Wahrscheinlichkeit"]}]}');
    const b = parseConcepts('Vorspann {"begriffe":[{"name":"Entropien","erklaerung":"Mittlerer Informationsgehalt einer Quelle","erklaert":true,"baut_auf":["Informationsgehalt"]}]}');
    const m = mergeConcepts([a, b]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ explains: true, definition: "Mittlerer Informationsgehalt einer Quelle", needs: ["Wahrscheinlichkeit", "Informationsgehalt"] });
    expect(parseConcepts("kaputt")).toEqual([]);
  });
});

describe("Ausbreitung", () => {
  test("drei Ebenen, jede schwächer, mit Weg zurück", () => {
    const links = [
      { from: "kap", to: "trans" },
      { from: "trans", to: "entropie" },
      { from: "entropie", to: "wahrsch" },
      { from: "wahrsch", to: "mengen" },
    ];
    const out = spread(new Map([["kap", 1]]), links);
    expect(out.get("trans")).toEqual({ depth: 1, strength: 0.5, via: "kap" });
    expect(out.get("entropie")).toMatchObject({ depth: 2, strength: 0.25, via: "trans" });
    expect(out.get("wahrsch")).toMatchObject({ depth: 3, strength: 0.125 });
    // Ebene 4 bleibt aus
    expect(out.has("mengen")).toBe(false);
  });

  test("stärkerer Weg gewinnt, Kreise laufen nicht endlos", () => {
    const out = spread(new Map([["a", 1], ["c", 0.6]]), [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "c", to: "b" }]);
    expect(out.get("b")).toMatchObject({ strength: 0.5, via: "a" });
    expect(out.get("a")).toMatchObject({ depth: 0, strength: 1 });
  });

  test("Speichern, Aktivieren und Grundlagen-Kapitel über Hefte hinweg", async () => {
    const { saveChapterConcepts } = await import("./store");
    const { activate, prerequisiteChapters } = await import("./activate");
    saveChapterConcepts("c1", "d1", [{ name: "Kanalkapazität", definition: "Maximale Transinformation", explains: true, needs: ["Transinformation"] }, { name: "Transinformation", definition: "Übertragene Information", explains: true, needs: ["Entropie"] }], "s1");
    saveChapterConcepts("c2", "d2", [{ name: "Entropie", definition: "Mittlerer Informationsgehalt", explains: true, needs: [] }], "s1");
    const active = activate(null, ["c1"]);
    const entropie = active.find((a) => a.name === "Entropie");
    expect(entropie?.depth).toBe(1);
    expect(prerequisiteChapters(active).map((p) => p.chapterId)).toContain("c2");
    expect(conceptNetText(active)).toContain("Transinformation → Entropie");
    // Zweiter Lauf desselben Kapitels ersetzt, statt zu verdoppeln
    saveChapterConcepts("c2", "d2", [{ name: "Entropie", definition: "Mittlerer Informationsgehalt", explains: true, needs: [] }], "s1");
    expect((dbm.db().prepare("SELECT COUNT(*) AS n FROM concept_mentions WHERE chapter_id = 'c2'").get() as { n: number }).n).toBe(1);
  });
});
