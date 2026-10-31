import { describe, expect, test } from "bun:test";
import { cleanStudyMarkdown, fixFormula, mapSymbols, stripPersonalData, UNSURE_FORMULA } from "./studyClean";
import { cleanForReading } from "./clean";

describe("Studienheft-Bereinigung", () => {
  test("Symbol-Font wird zu Unicode, ∈ ℕ und ∈ ℤ richtig", () => {
    expect(mapSymbols("x \uF03D 2\uF070")).toBe("x = 2π");
    expect(mapSymbols("n \uF0CE \uF0A5")).toBe("n ∈ ℕ");
    expect(mapSymbols("k \uF0CE \uF0A2")).toBe("k ∈ ℤ");
    expect(mapSymbols("Grenzwert \uF0A5")).toBe("Grenzwert ∞");
  });

  test("persönliche Fußzeile und Formularfelder verschwinden", () => {
    const t = "Text oben\n© HfB, 06.10.26, Muster, Max (1234567)\nMatrikel-Nr.:\nWeiter im Text";
    expect(stripPersonalData(t)).not.toContain("Muster");
    expect(stripPersonalData(t)).not.toContain("Matrikel");
    expect(cleanForReading(t)).toBe("Text oben\nWeiter im Text");
  });

  test("Formel: fehlende Gleichheitszeichen aus der Textebene, Ziffern zusammen", () => {
    expect(fixFormula("U \\, R \\cdot I", "U = R · I")).toBe("U = R \\cdot I");
    expect(fixFormula("R = 1 0 \\Omega")).toBe("R = 10 \\Omega");
    // Zwischen Zahl und Einheit kommt kein "="
    expect(fixFormula("10 \\, V", "10 V")).toBe("10 \\, V");
  });

  test("Formel: Buchstabensalat und Wörter, Verdächtiges wird markiert", () => {
    expect(fixFormula("x > 0 \\text{ for all } x")).toContain("für alle");
    expect(fixFormula("x = 1 \\quad a l s o \\quad y = 2")).toContain("\\text{also}");
    expect(fixFormula("Eingang Ausgang Masse Widerstand")).toContain(UNSURE_FORMULA);
  });

  test("Markdown: abgesetzte Formeln werden repariert", () => {
    expect(cleanStudyMarkdown("Text\n\n$$R = 1 0 \\Omega$$\n")).toBe("Text\n\n$$R = 10 \\Omega$$\n");
  });
});
