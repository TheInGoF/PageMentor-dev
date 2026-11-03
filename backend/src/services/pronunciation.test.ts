import { describe, expect, test } from "bun:test";
import { applyPronunciation, DEFAULT_PRONUNCIATION, examplesBlock, isAbbreviation } from "./pronunciation";
import { expandGermanAbbreviations } from "./abbreviations";

describe("Aussprache-Liste", () => {
  test("Anglizismen und Produktnamen, längere zuerst", () => {
    const out = applyPronunciation("Erstellt mit PageMentor. Gesprochen durch F5-TTS und Qwen3-TTS, nicht Qwen.", DEFAULT_PRONUNCIATION);
    expect(out).toBe("Erstellt mit Pejdsch-Mentor. Gesprochen durch Eff fünf Teh Teh Ess und Kwenn drei Teh Teh Ess, nicht Kwenn.");
  });
  test("nur ganze Wörter", () => {
    expect(applyPronunciation("Teamarbeit im Team", DEFAULT_PRONUNCIATION)).toBe("Teamarbeit im Tiem");
  });
  test("Doktortitel mit Ingenieur", () => {
    expect(expandGermanAbbreviations("Von Prof. Dr.-Ing. Stephan Kühne.")).toMatch(/Professor Doktor[- ]Ingenieur Stephan Kühne/);
  });

  test("Beispielblock nach Art gegliedert, Schema benannt", () => {
    expect(isAbbreviation("F5-TTS")).toBe(true);
    expect(isAbbreviation("USB")).toBe(true);
    expect(isAbbreviation("Workflow")).toBe(false);
    const block = examplesBlock([
      { from: "F5-TTS", to: "Eff fünf Teh Teh Ess", checked: true },
      { from: "Workflow", to: "Wörkflow", checked: true },
      { from: "Qwen", to: "Kwenn", checked: true },
    ]);
    expect(block).toContain("Abkürzungen, Buchstaben deutsch benannt");
    expect(block).toContain('  "F5-TTS" → "Eff fünf Teh Teh Ess"');
    expect(block).toContain("Englische Wörter und Namen in deutscher Lautschrift");
    expect(block.indexOf("Workflow")).toBeGreaterThan(block.indexOf("F5-TTS"));
    expect(examplesBlock([])).toBe("");
  });
  test("Qwen: englische Wörter im Original, Lautschrift von Gemma zurückgedreht, Abkürzungen bleiben", () => {
    const out = applyPronunciation("Erstellt mit Pejdsch-Mentor und PageMentor, im Team, mit F5-TTS.", DEFAULT_PRONUNCIATION, "qwen");
    expect(out).toBe("Erstellt mit PageMentor und PageMentor, im Team, mit Eff fünf Teh Teh Ess.");
    expect(applyPronunciation("im Team", DEFAULT_PRONUNCIATION, "tada")).toBe("im Tiem");
  });
});
