// Audiobookshelf: Kennzeichen und Treffer-Auswahl für das Ersetzen alter Fassungen
import { describe, expect, test } from "bun:test";
import { matchingItems, newestItem, pmTag, type SearchHit } from "./audiobookshelf";

const hit = (id: string, title: string, author: string, addedAt: number): SearchHit => ({ libraryItem: { id, addedAt, media: { metadata: { title, authorName: author } } } });

describe("Audiobookshelf-Ersatz", () => {
  test("Kennzeichen je Heft und Art", () => {
    expect(pmTag("d1")).toBe("pm:d1");
    expect(pmTag("d1", "subject")).toBe("pm:d1:subject");
  });

  test("alle Treffer mit gleichem Titel und Autor, nicht nur ein eindeutiger", () => {
    const hits = [hit("a", "Codierung", "Prof. X", 1), hit("b", "codierung ", "prof. x", 2), hit("c", "Codierung", "Jemand anders", 3), hit("d", "Information", "Prof. X", 4)];
    expect(matchingItems(hits, "Codierung", "Prof. X")).toEqual(["a", "b"]);
    expect(matchingItems(undefined, "Codierung", "Prof. X")).toEqual([]);
  });

  test("nach dem Upload zählt der neueste Eintrag mit diesem Titel", () => {
    const hits = [hit("alt", "Codierung", "Prof. X", 100), hit("neu", "Codierung", "Prof. X", 200), hit("x", "Anderes", "Prof. X", 300)];
    expect(newestItem(hits, "codierung")).toBe("neu");
    expect(newestItem(hits, "gibt es nicht")).toBeNull();
  });
});
