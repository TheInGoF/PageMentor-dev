import { describe, expect, test } from "bun:test";
import { markdownPlainText, similarity, textMinhash } from "./dedupe";
import { splitEmbeddedImages, stripImageData } from "../docling/images";

// Erfundener Lehrtext, keine echten Unterlagen
const words = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${(i * 7) % 997}`).join(" ");
const TEXT = `Das ohmsche Gesetz verbindet Spannung Strom und Widerstand. ${words(400, "begriff")}`;

describe("Text-Fingerabdruck", () => {
  test("gleicher Inhalt trotz anderer Umbrüche und Schreibweise", () => {
    const a = textMinhash(TEXT)!;
    const b = textMinhash(TEXT.toUpperCase().replace(/ /g, "\n  "))!;
    expect(similarity(a, b)).toBe(1);
  });
  test("kleine Abweichung bleibt ähnlich, anderer Text nicht", () => {
    const a = textMinhash(TEXT)!;
    const fast = textMinhash(TEXT.replace("Widerstand", "Leitwert") + " Nachtrag Seite")!;
    expect(similarity(a, fast)).toBeGreaterThan(0.9);
    expect(similarity(a, textMinhash(words(400, "anderes"))!)).toBeLessThan(0.2);
  });
  test("Docling-Markdown mit Bildern und Formeln gleicht der Textebene", () => {
    const md = `# Kapitel\n${TEXT}\n![Abbildung](bilder/bild_001_0123456789.png)\n<!-- image -->\n$$U = R \\cdot I$$ und $\\frac{a}{b}$`;
    expect(similarity(textMinhash(TEXT)!, textMinhash(markdownPlainText(md))!)).toBeGreaterThan(0.95);
  });
  test("zu wenig Text gibt keinen Fingerabdruck", () => {
    expect(textMinhash("nur ein paar Wörter")).toBeNull();
  });
});

describe("Bilder aus Docling", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
  const other = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]).toString("base64");
  test("als Datei abgelegt, Wiederholungen (Logo) nur einmal", () => {
    const md = `# 1 Schaltung\n![Bild](data:image/png;base64,${png})\nText\n![](data:image/png;base64,${png})\n![Kennlinie](data:image/jpeg;base64,${other})`;
    const r = splitEmbeddedImages(md);
    expect(r.images.map((i) => i.name)).toEqual([expect.stringMatching(/^bild_001_[0-9a-f]{10}\.png$/), expect.stringMatching(/^bild_002_[0-9a-f]{10}\.jpg$/)]);
    expect(r.markdown).toContain(`![Bild](bilder/${r.images[0].name})`);
    expect(r.markdown).not.toContain("base64");
    expect(r.markdown.match(/bilder\//g)!.length).toBe(2);
  });
  test("Bilddaten aus dem JSON entfernt, Rest bleibt", () => {
    expect(stripImageData({ pictures: [{ image: { uri: "data:image/png;base64,AAA", size: 3 }, ref: "x" }] })).toEqual({ pictures: [{ image: { size: 3 }, ref: "x" }] });
  });
});
