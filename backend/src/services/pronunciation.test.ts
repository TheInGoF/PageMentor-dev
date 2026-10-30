import { describe, expect, test } from "bun:test";
import { applyPronunciation, DEFAULT_PRONUNCIATION } from "./pronunciation";
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
});
