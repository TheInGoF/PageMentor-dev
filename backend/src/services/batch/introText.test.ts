import { describe, expect, test } from "bun:test";
import { defaultIntroText, introTitle } from "./introText";

describe("Intro aus den Metadaten", () => {
  test("PDF-Titel vor Dateiname", () => {
    expect(introTitle("Grundlagen der Elektrotechnik", "ET01_Heft_1.pdf")).toBe("Grundlagen der Elektrotechnik");
  });
  test("ohne Metadaten: Dateiname lesbar", () => {
    expect(introTitle(null, "ET01_Gleichstrom_Kreise.pdf")).toBe("ET01 Gleichstrom Kreise");
  });
  test("Text nennt Engine und Stimme", () => {
    const voice = { id: "f5:custom:1", label: "Thorsten (Vorlage)", engine: "f5", language: "de", locale: "de-DE", gender: "male" } as never;
    const text = defaultIntroText({ title: "Gleichstrom", author: "Prof. X", language: "de" }, voice, "gemma4:e4b");
    expect(text).toContain("Hörbuch: Gleichstrom.");
    expect(text).toContain("Von Prof. X.");
    expect(text).toContain("Gesprochen durch F5-TTS, mit der Stimme Thorsten.");
  });
});
