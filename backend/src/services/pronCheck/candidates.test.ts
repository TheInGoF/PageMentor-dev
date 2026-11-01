import { describe, expect, test } from "bun:test";
import { respellings } from "./candidates";

describe("Kandidaten aus der Bereinigung", () => {
  test("ersetzte Wörter mit großem Anfangsbuchstaben, keine Zahlen und keine Kleinwörter", () => {
    const original = "Der Workflow mit Qwen und 5 Schritten. Audiobookshelf ist gut, sagt Prof. Dr. Zimmermann.";
    const cleaned = "Der Wörkflou mit Kwenn und fünf Schritten. Odio-Buck-Schelf ist gut, sagt Professor Doktor Zimmermann.";
    expect(respellings(original, cleaned)).toEqual([
      { from: "Workflow", to: "Wörkflou" },
      { from: "Qwen", to: "Kwenn" },
      { from: "Audiobookshelf", to: "Odio-Buck-Schelf" },
      // „Prof“ kommt mit (Gemma sortiert ausgeschriebene Abkürzungen aus), „Dr“ hat zu wenig Buchstaben
      { from: "Prof", to: "Professor" },
    ]);
  });

  test("unveränderte Texte und reine Umstellungen liefern nichts Brauchbares", () => {
    expect(respellings("Die Entropie der Quelle.", "Die Entropie der Quelle.")).toEqual([]);
    expect(respellings("Das heißt 3 Bit.", "Das heißt drei Bit.")).toEqual([]);
  });
});
