import { describe, expect, test } from "bun:test";
import { clamp, measure, ready, renderPng, wrap } from "./text";
import { coverSvg, KIND_LABEL } from "./templates";

await ready();
const bold = { size: 58, weight: 700 as const };

describe("Cover-Text", () => {
  test("misst Breiten mit der eingebetteten Schrift", () => {
    expect(measure("Information", bold)).toBeGreaterThan(200);
    expect(measure("Information", bold)).toBeLessThan(400);
    expect(measure("iii", bold)).toBeLessThan(measure("WWW", bold));
  });

  test("bricht an Wortgrenzen und trennt lange Wörter nur auf Wunsch", () => {
    const lines = wrap("Feldeffekttransistoren und Operationsverstärker", bold, 392, false);
    expect(lines).toEqual(["Feldeffekttransistoren", "und", "Operationsverstärker"]);
    expect(wrap("Wahrscheinlichkeitsrechnung", bold, 300, false)).toEqual(["Wahrscheinlichkeitsrechnung"]);
    const broken = wrap("Wahrscheinlichkeitsrechnung", bold, 300, true);
    expect(broken.length).toBeGreaterThan(1);
    expect(broken[0].endsWith("-")).toBe(true);
    for (const l of broken) expect(measure(l, bold)).toBeLessThanOrEqual(300);
  });

  test("feste Schriftgröße: höchstens drei Zeilen, darüber mit „…“ gekappt", () => {
    const f = { size: 36, weight: 700 as const };
    const short = clamp("Information", f, 392, 3, 1.15);
    expect(short.lines).toEqual(["Information"]);
    expect(short.cut).toBe(false);
    const long = clamp("Investitionsrechnung und Finanzierungsentscheidungen in mittelständischen Unternehmen", f, 392, 3, 1.15);
    expect(long.cut).toBe(true);
    expect(long.lines.length).toBe(3);
    expect(long.lines[2].endsWith("…")).toBe(true);
    expect(long.lines.every((l) => measure(l, f) <= 392)).toBe(true);
    // Ein zu breites Wort wird getrennt, der Trennstrich bleibt nicht vor dem „…“ stehen
    const word = clamp("Wahrscheinlichkeitsrechnung", f, 392, 3, 1.15);
    expect(word.lines.length).toBe(2);
    expect(word.lines[0].endsWith("-")).toBe(true);
    expect(clamp("Wahrscheinlichkeitsrechnung der Zufallsgrößen und Verteilungen", f, 200, 1, 1.15).lines[0]).toMatch(/[^-]…$/);
  });

  test("Vorlagen enthalten Titel und Pille und ergeben ein PNG", () => {
    for (const style of ["a", "c", "d"] as const) {
      const svg = coverSvg({ style, aspect: "book", kind: "language", title: "Spanisch für Anfänger 1", color: "#1c7a5a", image: null });
      expect(svg).toContain("Spanisch für");
      expect(svg).toContain("Anfänger 1");
      expect(svg).toContain(style === "d" ? KIND_LABEL.language : KIND_LABEL.language.toUpperCase());
      const png = renderPng(svg, 300);
      expect(Array.from(png.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    }
  });

  test("Kopfhörer sitzt bei kurzem und langem Titel an derselben Stelle", () => {
    const at = (title: string) => /translate\(([\d.]+ [\d.]+)\) scale\(4\.\d+\)/.exec(coverSvg({ style: "c", aspect: "book", kind: "subject", title, color: "#1565c0", image: null }))?.[1];
    expect(at("Information")).toBeDefined();
    expect(at("Information")).toBe(at("Investitionsrechnung und Finanzierungsentscheidungen in mittelständischen Unternehmen"));
  });

  test("helle Modulfarbe bekommt dunkle Schrift, dunkle Farbe weiße", () => {
    const yellow = coverSvg({ style: "c", aspect: "square", kind: "subject", title: "T", color: "#facc15", image: null });
    const navy = coverSvg({ style: "c", aspect: "square", kind: "subject", title: "T", color: "#0b3d91", image: null });
    expect(yellow).toContain('fill="#111827"');
    expect(navy).toContain('fill="#ffffff"');
  });
});
