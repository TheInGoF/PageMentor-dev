import { describe, expect, test } from "bun:test";
import { renderTeilaufgabe } from "./render";

describe("renderTeilaufgabe", () => {
  test("Schritte mit Warum und Rechnung, dazu Idee und Ergebnis", () => {
    const it = renderTeilaufgabe(
      { nummer: "1", titel: "Ohmsches Gesetz" },
      {
        nummer: "a",
        typ_erkennen: "Spannung und Widerstand gegeben",
        gesucht: "I in A",
        idee: "Strom aus Spannung und Widerstand.",
        schritte: [{ was: "Strom berechnen", warum: "Das ohmsche Gesetz verbindet U, R und I.", rechnung: "I = \\frac{12\\,V}{4\\,\\Omega} = 3\\,A" }],
        ergebnis: "3 A",
        unsicher: false,
      }
    );
    expect(it.body).toContain("**Idee:** Strom aus Spannung und Widerstand.");
    expect(it.body).toContain("1. **Strom berechnen**\n   *Warum:* Das ohmsche Gesetz verbindet U, R und I.\n   $I = \\frac{12\\,V}{4\\,\\Omega} = 3\\,A$");
    expect(it.body).toContain("**Ergebnis:** 3 A");
  });
  test("alte Einträge mit Text-Schritten bleiben lesbar", () => {
    const it = renderTeilaufgabe({ nummer: "1", titel: "" }, { nummer: "b", typ_erkennen: "x", gesucht: "y", schritte: ["Gesamtwiderstand", "Strom"] });
    expect(it.body).toContain("1. Gesamtwiderstand\n2. Strom");
  });
});
