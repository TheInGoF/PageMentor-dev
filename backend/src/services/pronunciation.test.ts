import { describe, expect, test } from "bun:test";
import { applyPronunciation, DEFAULT_PRONUNCIATION } from "./pronunciation";
import { expandGermanAbbreviations } from "./abbreviations";

describe("Aussprache-Liste", () => {
  test("Anglizismen und Produktnamen, längere zuerst", () => {
    const out = applyPronunciation("Erstellt mit PageMentor. Gesprochen durch F5-TTS und Qwen3-TTS, nicht Qwen.", DEFAULT_PRONUNCIATION);
    expect(out).toBe("Erstellt mit Pejdsch-Mentor. Gesprochen durch F fünf T T S und Kwenn drei T T S, nicht Kwenn.");
  });
  test("nur ganze Wörter", () => {
    expect(applyPronunciation("Teamarbeit im Team", DEFAULT_PRONUNCIATION)).toBe("Teamarbeit im Tiem");
  });
  test("Doktortitel mit Ingenieur", () => {
    expect(expandGermanAbbreviations("Von Prof. Dr.-Ing. Stephan Kühne.")).toMatch(/Professor Doktor[- ]Ingenieur Stephan Kühne/);
  });
});
