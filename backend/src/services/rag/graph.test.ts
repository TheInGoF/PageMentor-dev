import { describe, expect, test } from "bun:test";
import { terms, topicsFor, weightedTerms } from "./graph";

describe("Zusammenhänge", () => {
  test("Fachbegriffe ohne Allerweltswörter", () => {
    const t = terms("Die Entropie einer Quelle. Abbildung 3 zeigt die Entropie und die Redundanz.");
    expect(t.get("Entropie")).toBe(2);
    expect(t.has("Abbildung")).toBe(false);
  });
  test("Themen aus verbundenen Kapiteln, benannt nach gemeinsamen Begriffen", () => {
    const w = weightedTerms(
      new Map([
        ["a", "Entropie Entropie Redundanz Redundanz Quelle"],
        ["b", "Entropie Entropie Redundanz Redundanz Kanal Kanal"],
        ["c", "Filter Filter Abtastung Abtastung"],
      ])
    );
    const topics = topicsFor(["a", "b", "c"], [{ a: "a", b: "b", weight: 0.9 }], w);
    expect(topics).toHaveLength(1);
    expect(topics[0].nodes.sort()).toEqual(["a", "b"]);
    expect(topics[0].terms).toEqual(expect.arrayContaining(["Entropie", "Redundanz"]));
  });
});
