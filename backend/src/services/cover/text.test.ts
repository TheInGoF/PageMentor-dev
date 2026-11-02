import { describe, expect, test } from "bun:test";
import { fit, measure, ready, renderPng, wrap } from "./text";
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

  test("schrumpft, bis Titel in Breite und Zeilenzahl passen", () => {
    const f = fit("Investitionsrechnung und Finanzierungsentscheidungen in mittelständischen Unternehmen", { weight: 700, maxWidth: 392, maxHeight: 400, maxSize: 58, minSize: 18, lineHeight: 1.1, maxLines: 5 });
    expect(f.overflow).toBe(false);
    expect(f.lines.length).toBeLessThanOrEqual(5);
    expect(f.lines.every((l) => measure(l, { size: f.size, weight: 700 }) <= 392)).toBe(true);
    expect(f.lines.some((l) => l.endsWith("-"))).toBe(false);
    expect(fit("Information", { weight: 700, maxWidth: 392, maxHeight: 400, maxSize: 58, minSize: 18, lineHeight: 1.1 }).size).toBe(58);
  });

  test("kappt mit Auslassungspunkten, wenn selbst die Mindestgröße nicht reicht", () => {
    const f = fit("Ein sehr langer Titel mit vielen Wörtern, der niemals in zwei kurze Zeilen passt", { weight: 700, maxWidth: 200, maxHeight: 50, maxSize: 30, minSize: 20, lineHeight: 1.1 });
    expect(f.overflow).toBe(true);
    expect(f.lines.length).toBe(2);
    expect(f.lines[1].endsWith("…")).toBe(true);
  });

  test("Vorlagen enthalten Titel, Modul und Pille und ergeben ein PNG", () => {
    for (const style of ["a", "c", "d"] as const) {
      const svg = coverSvg({ style, aspect: "book", kind: "language", title: "Spanisch für Anfänger 1", module: "Spanisch (WP Sprache)", color: "#1c7a5a", image: null });
      expect(svg).toContain("Spanisch");
      expect(svg).toContain("Anfänger 1");
      expect(svg).toContain("SPANISCH (WP SPRACHE)");
      expect(svg).toContain(style === "d" ? KIND_LABEL.language : KIND_LABEL.language.toUpperCase());
      const png = renderPng(svg, 300);
      expect(Array.from(png.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    }
  });

  test("helle Modulfarbe bekommt dunkle Schrift, dunkle Farbe weiße", () => {
    const yellow = coverSvg({ style: "c", aspect: "square", kind: "subject", title: "T", module: null, color: "#facc15", image: null });
    const navy = coverSvg({ style: "c", aspect: "square", kind: "subject", title: "T", module: null, color: "#0b3d91", image: null });
    expect(yellow).toContain('fill="#111827"');
    expect(navy).toContain('fill="#ffffff"');
  });
});
