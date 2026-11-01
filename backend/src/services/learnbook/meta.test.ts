import { describe, expect, test } from "bun:test";
import { introText, learnAuthor, learnFileSuffix, learnTitle } from "./meta";

describe("Lernhörbuch: Name, Autor, Intro", () => {
  test("Zusatz je Art", () => {
    expect(learnTitle("Spanisch A1", "language")).toBe("Spanisch A1 – Sprachlern-Hörbuch");
    expect(learnTitle("Informationstheorie", "subject")).toBe("Informationstheorie – Lernhörbuch");
    expect(learnFileSuffix("language")).toBe(" - Sprachlern-Hoerbuch");
  });

  test("Autor mit „nach dem Buch von“", () => {
    expect(learnAuthor("Max Muster")).toBe("nach dem Buch von Max Muster");
    expect(learnAuthor("  ")).toBe("PageMentor");
    expect(learnAuthor("Ana Babiloni; Hildegard Ritter")).toBe("nach dem Buch von Ana Babiloni und Hildegard Ritter");
  });

  test("Intro nennt Titel, Autor, Umfang und Lernweise", () => {
    const de = introText({ kind: "language", lang: "es", title: "Spanisch A1", author: "Max Muster", units: 12 });
    expect(de).toStartWith("Spanisch A1 – Sprachlern-Hörbuch. Nach dem Buch von Max Muster.");
    expect(de).toContain("Du lernst Spanisch in 12 Einheiten");
    expect(introText({ kind: "subject", lang: "es", title: "IT", author: null, units: 3 })).toStartWith("IT – Lernhörbuch. 3 Einheiten");
  });
});
