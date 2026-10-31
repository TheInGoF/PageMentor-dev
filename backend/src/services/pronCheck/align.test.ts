import { describe, expect, test } from "bun:test";
import { alignWords, findIssues, norm, type HeardWord } from "./align";

const heard = (s: string, probs: Record<number, number> = {}): HeardWord[] =>
  s.split(" ").map((w, i) => ({ word: w, start: i, end: i + 0.8, prob: probs[i] ?? 0.95 }));

describe("Ausspracheprüfung: Abgleich", () => {
  test("Normalisierung", () => {
    expect(norm("Kanal-Kapazität,")).toBe("kanalkapazität");
    expect(norm("„Workflow“")).toBe("workflow");
  });

  test("gleicher Text ohne Befund", () => {
    expect(findIssues("Das Update kommt morgen.", heard("Das Update kommt morgen."))).toEqual([]);
  });

  test("falsch gesprochenes Wort mit Zeit und Zusammenhang", () => {
    const f = findIssues("Der neue Workflow ist schnell", heard("Der neue Wörkflo ist schnell"));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "different", expected: "Workflow", heard: "Wörkflo", start: 2, end: 2.8 });
    expect(f[0].context).toContain("neue Workflow ist");
  });

  test("verschluckt und zusätzlich", () => {
    const miss = findIssues("eins zwei drei vier", heard("eins drei vier"));
    expect(miss).toMatchObject([{ kind: "missing", expected: "zwei", heard: "" }]);
    const extra = findIssues("eins zwei drei", heard("eins zwei zwei drei"));
    expect(extra).toMatchObject([{ kind: "extra", expected: "", heard: "zwei" }]);
  });

  test("unsichere Wörter, Zahlen zählen nicht", () => {
    const f = findIssues("Im Jahr 1990 kam Software", heard("Im Jahr neunzehnhundertneunzig kam Software", { 4: 0.3 }));
    expect(f).toMatchObject([{ kind: "unsure", expected: "Software", prob: 0.3 }]);
  });

  test("lange Wörter mit kleinem Hörfehler gelten als gleich", () => {
    expect(findIssues("Informationsgehalt", heard("Informationsgehalts"))).toEqual([]);
  });

  test("lange Texte in Fenstern", () => {
    const words = Array.from({ length: 4000 }, (_, i) => `wort${i}`);
    const h = words.filter((_, i) => i !== 2500).join(" ");
    const f = findIssues(words.join(" "), heard(h));
    expect(f.map((x) => x.expected)).toContain("wort2500");
    expect(f.length).toBeLessThanOrEqual(3);
  });

  test("Ausrichtung direkt", () => {
    expect(alignWords(["a", "b"], ["a", "c", "b"]).map((o) => o.t)).toEqual(["match", "ins", "match"]);
  });
});
