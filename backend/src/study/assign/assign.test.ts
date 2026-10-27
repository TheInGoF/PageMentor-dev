import { describe, expect, test } from "bun:test";
import { classify, findDate } from "./classify";
import { checkQuality } from "./quality";

const MODS = [
  { code: "ABCDPS", prefixes: [{ prefix: "ABC", confirmed: true }] },
  { code: "XYZQPS", prefixes: [{ prefix: "XYZ", confirmed: true }, { prefix: "XY", confirmed: false }] },
  { code: "LMNOPS", prefixes: [{ prefix: "LMN", confirmed: false }] },
];

describe("classify", () => {
  test("Kürzel im Dateinamen ist sicher", () => {
    const c = classify("Klausur_ABCDPS_2021.pdf", "", MODS);
    expect(c).toMatchObject({ code: "ABCDPS", sure: true, kind: "klausur", date: "2021" });
  });
  test("Präfix im Namen, längster gewinnt", () => {
    expect(classify("XYZ03_Lehrheft.pdf", "", MODS)).toMatchObject({ code: "XYZQPS", rule: "praefix:XYZ@name", sure: true });
  });
  test("unbelegter Präfix ist nur Vorschlag", () => {
    expect(classify("LMN02.pdf", "", MODS)).toMatchObject({ code: "LMNOPS", sure: false });
  });
  test("Kürzel im Kopf sicher, Präfix im Kopf nur Vorschlag", () => {
    expect(classify("scan.pdf", "Modul ABCDPS\nText", MODS)).toMatchObject({ code: "ABCDPS", sure: true });
    expect(classify("scan.pdf", "Heft XYZ05 Kapitel", MODS)).toMatchObject({ code: "XYZQPS", sure: false });
  });
  test("thematische Nähe zählt nie", () => {
    expect(classify("Elektrotechnik Grundlagen.pdf", "Ohmsches Gesetz und Widerstände", MODS)).toMatchObject({ code: null, rule: "kein_treffer" });
  });
  test("unbekannter Heftcode verhindert Automatik", () => {
    const c = classify("ABCDPS_neu.pdf", "Studienheft QRS01", MODS);
    expect(c).toMatchObject({ code: "ABCDPS", sure: false, heftCode: "QRS01" });
  });
  test("Verwaltungsdokumente gehören in kein Modul", () => {
    expect(classify("Notenbescheid ABCDPS.pdf", "Klausur", MODS)).toMatchObject({ code: null, rule: "sondertyp:verwaltung" });
  });
  test("Datum", () => {
    expect(findDate("Klausur 14.07.21.pdf", "")).toBe("2021-07");
    expect(findDate("ABC01_1119K08.pdf", "")).toBe("2019-11");
    expect(findDate("x.pdf", "Prüfung im März 2023")).toBe("2023-03");
  });
});

describe("checkQuality", () => {
  test("verlorene Formeln werden gemeldet", () => {
    const q = checkQuality("Text ".repeat(300) + "<!-- formula-not-decoded --> und <!-- formula-not-decoded -->", 2);
    expect(q.formulaMissing).toBe(2);
    expect(q.flag).toBe(true);
  });
  test("sauberer Text ohne Befund", () => {
    const md = "Der Widerstand $R = \\frac{U}{I}$ bestimmt den Strom. ".repeat(40);
    const q = checkQuality(md, 2);
    expect(q).toMatchObject({ formulaMissing: 0, flag: false });
    expect(q.formulaLatex).toBeGreaterThan(0);
  });
  test("zu wenig Text je Seite", () => {
    expect(checkQuality("kurz", 10).reasons[0]).toContain("Zeichen");
  });
});
