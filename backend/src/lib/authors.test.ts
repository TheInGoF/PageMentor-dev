import { describe, expect, test } from "bun:test";
import { joinAuthors, splitAuthors, spokenAuthors } from "./authors";

describe("Mehrere Autoren", () => {
  test("Trennzeichen", () => {
    expect(splitAuthors("Ana Babiloni und Hildegard Ritter")).toEqual(["Ana Babiloni", "Hildegard Ritter"]);
    expect(splitAuthors("Ana Babiloni; Hildegard Ritter")).toEqual(["Ana Babiloni", "Hildegard Ritter"]);
    expect(splitAuthors("Ana Babiloni, Hildegard Ritter, Max Muster")).toEqual(["Ana Babiloni", "Hildegard Ritter", "Max Muster"]);
    expect(splitAuthors("A. Meier & B. Schulz")).toEqual(["A. Meier", "B. Schulz"]);
  });

  test("„Nachname, Vorname“ bleibt eine Person, leer bleibt leer", () => {
    expect(splitAuthors("Babiloni, Ana")).toEqual(["Babiloni, Ana"]);
    expect(splitAuthors("  ")).toEqual([]);
    expect(splitAuthors(null)).toEqual([]);
  });

  test("Vorlesen mit „und“", () => {
    expect(spokenAuthors("Ana Babiloni; Hildegard Ritter")).toBe("Ana Babiloni und Hildegard Ritter");
    expect(joinAuthors(["A", "B", "C"])).toBe("A, B und C");
    expect(joinAuthors(["A", "B"], "en")).toBe("A and B");
    expect(spokenAuthors("Max Muster")).toBe("Max Muster");
  });
});
