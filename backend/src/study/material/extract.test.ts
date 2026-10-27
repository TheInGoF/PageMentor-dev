// Extraktion mit Schein-KI und erfundenem Heft
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Ask } from "./extract";

const TMP = mkdtempSync(join(tmpdir(), "pm-material-"));
type Mods = { db: typeof import("../../db"); ex: typeof import("./extract") };
let x: Mods;

const fake: Ask = async (kind, text) => {
  if (text.includes("KAPUTT")) return null;
  if (kind === "merksatz")
    return { merksaetze: [{ titel: "Ohm", kategorie: "regel", merksatz: "Spannung ist Widerstand mal Strom.", erklaerung: "Je größer R, desto größer U.", unsicher: false }] };
  if (kind === "formel")
    return {
      formeln: [
        { name: "Ohmsches Gesetz", formel: "U = R \\cdot I", symbole: [{ symbol: "U", bedeutung: "Spannung", einheit: "V" }], anwendungsfall: "Wenn R und I gegeben sind.", unsicher: false },
        { name: "Leistung", formel: "P = U \\cdot I", unsicher: true },
      ],
    };
  if (kind === "aufgabe")
    return { aufgaben: [{ nummer: "1", titel: "Spannungsteiler", teilaufgaben: [{ nummer: "a", typ_erkennen: "zwei Widerstände in Reihe", gesucht: "U_2", schritte: ["Gesamtwiderstand", "Strom", "Teilspannung"], unsicher: false }] }] };
  return { aufgabentypen: [{ code: "A1", titel: "Spannungsteiler", worum_gehts: "Teilspannung bestimmen", erkennen: "Reihenschaltung", vorgehen: ["R ges", "I", "U_2"], stolperfalle: "Belastung vergessen" }] };
};

beforeAll(async () => {
  x = { db: await import("../../db"), ex: await import("./extract") };
  x.db.useDatabaseFile(join(TMP, "test.db"));
  x.db.initDb();
  const d = x.db.db();
  d.prepare("INSERT INTO modules (id, name, code) VALUES ('m1', 'Testmodul', 'TEST1')").run();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path, module_id, heft_code) VALUES ('h1', 'Heft Eins', 'h.pdf', '', 'm1', 'TH01')").run();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path, module_id, type) VALUES ('k1', 'Klausur März', 'k.pdf', '', 'm1', 'klausur')").run();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path) VALUES ('o1', 'Ohne Modul', 'o.pdf', '')").run();
  const ch = d.prepare("INSERT INTO chapters (id, document_id, number, title, text, kind) VALUES (?, ?, ?, ?, ?, ?)");
  ch.run("c1", "h1", 1, "Grundlagen", "Das ohmsche Gesetz. ".repeat(50), "content");
  ch.run("c2", "h1", 2, "Inhaltsverzeichnis", "1 ... 2 ...", "index");
  ch.run("c3", "k1", 1, "Aufgabe 1", "Berechne die Teilspannung.", "exercise");
  ch.run("c4", "o1", 1, "x", "y", "content");
});

describe("Hilfen", () => {
  test("Abschnitte mit Überlappung", () => {
    const parts = x.ex.chunkText("a".repeat(50_000));
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(20_000);
  });
  test("JSON auch mit Vorspann", () => {
    expect(x.ex.parseJson('<think>hm</think>Hier:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(x.ex.parseJson("kein json")).toBeNull();
  });
  test("Quellcode aus Heftcode oder Titel", () => {
    expect(x.ex.sourceCode({ heft_code: "TH01", title: "x" })).toBe("TH01");
    expect(x.ex.sourceCode({ title: "Übung Größen 2" })).toBe("UEBUNG-GROESSEN");
  });
});

describe("Extraktion", () => {
  test("Heft: Merksätze und Formeln mit Grep-ID", async () => {
    const r = await x.ex.extractFromDocument("h1", undefined, fake);
    expect(r.map((k) => [k.kind, k.items, k.uncertain])).toEqual([["merksatz", 1, 0], ["formel", 2, 1]]);
    const f = x.db.db().prepare("SELECT id, title, body_md, uncertain, source_document_id FROM material_items WHERE kind = 'formel' ORDER BY id").all() as any[];
    expect(f[0]).toMatchObject({ id: "TEST1-F-TH01-01", title: "Ohmsches Gesetz", uncertain: 0, source_document_id: "h1" });
    expect(f[0].body_md).toContain("$$U = R \\cdot I$$");
    expect(f[1].uncertain).toBe(1);
    // Verzeichnis-Kapitel geht nicht an die KI
    let seen = "";
    await x.ex.extractFromDocument("h1", ["merksatz"], async (k, t) => ((seen += t), fake(k, t)));
    expect(seen).not.toContain("Inhaltsverzeichnis");
  });

  test("zweiter Lauf ersetzt, statt zu verdoppeln", async () => {
    await x.ex.extractFromDocument("h1", undefined, fake);
    expect((x.db.db().prepare("SELECT COUNT(*) AS n FROM material_items WHERE source_document_id = 'h1'").get() as any).n).toBe(3);
  });

  test("Klausur: Teilaufgaben, dann Rezepte fürs Modul", async () => {
    const r = await x.ex.extractFromDocument("k1", undefined, fake);
    expect(r[0]).toMatchObject({ kind: "aufgabe", items: 1 });
    const a = x.db.db().prepare("SELECT id, title, body_md FROM material_items WHERE kind = 'aufgabe'").get() as any;
    expect(a.id).toBe("TEST1-A-KLAUSUR-MAERZ-01");
    expect(a.body_md).toContain("1. Gesamtwiderstand");
    const rec = await x.ex.synthesizeRecipes("m1", fake);
    expect(rec.items).toBe(1);
    expect(x.db.db().prepare("SELECT id FROM material_items WHERE kind = 'rezept'").get()).toEqual({ id: "TEST1-R-A1" });
  });

  test("fehlgeschlagene Abschnitte werden gezählt, nicht verschwiegen", async () => {
    x.db.db().prepare("UPDATE chapters SET text = 'KAPUTT' WHERE id = 'c1'").run();
    const r = await x.ex.extractFromDocument("h1", ["merksatz"], fake);
    expect(r[0]).toMatchObject({ items: 0, failedChunks: 1 });
  });

  test("ohne Modul klare Meldung", async () => {
    await expect(x.ex.extractFromDocument("o1", undefined, fake)).rejects.toThrow("Modul");
  });
});
