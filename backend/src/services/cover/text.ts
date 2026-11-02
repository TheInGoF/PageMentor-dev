// Textmaß und Zeilenumbruch fürs Cover: resvg misst mit denselben Schriften, mit denen es später zeichnet.
// WASM und Schriftschnitte werden als Datei eingebunden und stecken in der Exe
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import wasmPath from "@resvg/resvg-wasm/index_bg.wasm" with { type: "file" };
import regularPath from "../../../assets/fonts/Inter-Regular.otf" with { type: "file" };
import boldPath from "../../../assets/fonts/Inter-Bold.otf" with { type: "file" };

export const FONT = "Inter";
export type Weight = 400 | 700;
// Buchstabenabstand in em (0.08 = 8 % der Schriftgröße)
export type Face = { size: number; weight: Weight; spacing?: number };

let fonts: Uint8Array[] = [];
let init: Promise<void> | null = null;

export function ready(): Promise<void> {
  init ??= (async () => {
    await initWasm(await Bun.file(wasmPath).arrayBuffer());
    fonts = await Promise.all([regularPath, boldPath].map(async (p) => new Uint8Array(await Bun.file(p).arrayBuffer())));
  })();
  return init;
}

export function fontOptions() {
  return { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: FONT };
}

// SVG in ein PNG mit der Breite width zeichnen
export function renderPng(svg: string, width: number): Uint8Array {
  return new Resvg(svg, { font: fontOptions(), fitTo: { mode: "width", value: width } }).render().asPng();
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Ein Textelement; y ist die Grundlinie
export function textEl(text: string, x: number, y: number, f: Face, attrs = ""): string {
  const ls = f.spacing ? ` letter-spacing="${(f.size * f.spacing).toFixed(2)}"` : "";
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="${f.weight}" font-size="${f.size}"${ls} ${attrs}>${esc(text)}</text>`;
}

// Breite bei Schriftgröße 100, je Wort gemerkt; Schrift skaliert linear
const units = new Map<string, number>();
function unit(text: string, weight: Weight, spacing: number): number {
  const key = `${weight}|${spacing}|${text}`;
  const hit = units.get(key);
  if (hit !== undefined) return hit;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="300">${textEl(text, 0, 200, { size: 100, weight, spacing })}</svg>`;
  const bb = new Resvg(svg, { font: fontOptions() }).getBBox();
  const w = bb ? bb.x + bb.width : 0;
  units.set(key, w);
  return w;
}

// Tintenbreite eines Textstücks in SVG-Einheiten; vorher ready() abwarten
export function measure(text: string, f: Face): number {
  if (!text) return 0;
  return (unit(text, f.weight, f.spacing ?? 0) * f.size) / 100;
}

// Zeilen für die Breite; zu lange Wörter werden nur getrennt, wenn erlaubt (Trennstrich am Zeilenende)
export function wrap(text: string, f: Face, maxWidth: number, hyphenate: boolean): string[] {
  const lines: string[] = [];
  let line = "";
  const push = (word: string) => {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next, f) <= maxWidth) line = next;
    else {
      lines.push(line);
      line = word;
    }
  };
  for (const word of text.trim().split(/\s+/)) {
    if (!hyphenate || measure(word, f) <= maxWidth) {
      push(word);
      continue;
    }
    // Wort stückweise, jedes Stück mit Trennstrich so breit wie möglich
    let rest = word;
    while (measure(rest, f) > maxWidth && rest.length > 2) {
      let n = rest.length - 1;
      while (n > 1 && measure(`${rest.slice(0, n)}-`, f) > maxWidth) n--;
      push(`${rest.slice(0, n)}-`);
      lines.push(line);
      line = "";
      rest = rest.slice(n);
    }
    push(rest);
  }
  if (line) lines.push(line);
  return lines;
}

export type Block = { size: number; lines: string[]; lineHeight: number; height: number; cut: boolean };

// Feste Schriftgröße: umbrechen, zu breite Wörter trennen, ab maxLines mit „…“ kappen
export function clamp(text: string, f: Face, maxWidth: number, maxLines: number, lineHeight: number): Block {
  const all = wrap(text.trim(), f, maxWidth, true);
  const cut = all.length > maxLines;
  const lines = all.slice(0, maxLines);
  if (cut) {
    let last = lines[lines.length - 1].replace(/-$/, "");
    while (last.length > 1 && measure(`${last}…`, f) > maxWidth) last = last.slice(0, -1).trimEnd();
    lines[lines.length - 1] = `${last}…`;
  }
  return { size: f.size, lines, lineHeight, height: lines.length * f.size * lineHeight, cut };
}

// Zeilen eines Blocks zeichnen; top ist die Oberkante des Textblocks
export function lines(f: Block, x: number, top: number, weight: Weight, attrs = "", spacing?: number): string {
  const step = f.size * f.lineHeight;
  // Grundlinie: Versalhöhe von Inter ≈ 0,73 em, mittig im Zeilenkasten
  const base = top + step / 2 + f.size * 0.36;
  return f.lines.map((l, i) => textEl(l, x, Number((base + i * step).toFixed(2)), { size: f.size, weight, spacing }, attrs)).join("");
}
