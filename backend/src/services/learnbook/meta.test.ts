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
    expect(de).toStartWith("Sprachlern-Hörbuch: Spanisch A1.\n\nNach dem Buch von Max Muster.\nZum Lernen aufbereitet durch KI.");
    expect(de).toContain("Du lernst Spanisch in 12 Einheiten");
    expect(de).toEndWith("Erstellt mit PageMentor.");
    expect(introText({ kind: "subject", lang: "es", title: "IT", author: null, units: 3 })).toStartWith("Lernhörbuch: IT.\n\nZum Lernen aufbereitet durch KI.\n3 Einheiten");
    expect(introText({ kind: "subject", lang: "es", title: "IT", author: null, units: 3, module: "Informatik", model: "qwen3.6:27b" })).toStartWith("Informatik.\nLernhörbuch: IT.\n\nZum Lernen aufbereitet durch qwen3.6:27b.");
  });
});
