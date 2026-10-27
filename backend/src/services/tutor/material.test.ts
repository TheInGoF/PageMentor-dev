import { describe, expect, test } from "bun:test";
import { materialSources, scoreItem, tokens } from "./material";

describe("Katalog-Suche für den Tutor", () => {
  test("Stoppwörter fallen weg", () => {
    expect(tokens("Was ist der Spannungsteiler?")).toEqual(["spannungsteiler"]);
  });
  test("Titeltreffer zählt mehr als Text", () => {
    const q = tokens("Spannungsteiler berechnen");
    expect(scoreItem(q, "Spannungsteiler", "Formel für U2")).toBeGreaterThan(scoreItem(q, "Ohm", "Spannungsteiler kurz erwähnt"));
    expect(scoreItem(q, "Leistung", "P = U I")).toBe(0);
  });
  test("Quelle mit Grep-ID und Seite aus dem Verweis", () => {
    const [s] = materialSources(
      [{ id: "ABC-F-H1-01", kind: "formel", title: "Ohm", body_md: "U = R I", source_document_id: "d1", source_ref: "S. 14", doc_title: "Heft", doc_short_code: null, score: 3 }],
      5
    );
    expect(s).toMatchObject({ n: 5, grepId: "ABC-F-H1-01", docId: "d1", startPage: 14 });
  });
});
