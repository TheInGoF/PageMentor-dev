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

export type FitOpts = { weight: Weight; spacing?: number; maxWidth: number; maxHeight: number; maxSize: number; minSize: number; lineHeight: number; maxLines?: number };
export type Fit = { size: number; lines: string[]; lineHeight: number; height: number; overflow: boolean };

// Größte Schriftgröße, bei der der Text in Breite und Höhe passt. Erst ohne Worttrennung schrumpfen,
// dann mit; passt er selbst bei Mindestgröße nicht, werden die letzten Zeilen mit „…“ gekappt
export function fit(text: string, o: FitOpts): Fit {
  const result = (size: number, lines: string[], overflow = false): Fit => ({ size, lines, lineHeight: o.lineHeight, height: lines.length * size * o.lineHeight, overflow });
  const fits = (size: number, lines: string[]) =>
    lines.length * size * o.lineHeight <= o.maxHeight + 0.01 && (!o.maxLines || lines.length <= o.maxLines) && lines.every((l) => measure(l, { size, weight: o.weight, spacing: o.spacing }) <= o.maxWidth);
  for (const hyphenate of [false, true]) {
    // Die größte passende Schrift; etwas kleiner (bis 15 %) darf es werden, wenn das eine Zeile spart
    let best: Fit | null = null;
    for (let size = o.maxSize; size >= o.minSize; size--) {
      if (best && size < best.size * 0.85) break;
      const lines = wrap(text, { size, weight: o.weight, spacing: o.spacing }, o.maxWidth, hyphenate);
      if (fits(size, lines) && (!best || lines.length < best.lines.length)) best = result(size, lines);
    }
    if (best) return best;
  }
  const size = o.minSize;
  const f: Face = { size, weight: o.weight, spacing: o.spacing };
  const room = Math.max(1, Math.min(o.maxLines ?? Infinity, Math.floor(o.maxHeight / (size * o.lineHeight))));
  const lines = wrap(text, f, o.maxWidth, true).slice(0, room);
  let last = lines[lines.length - 1];
  while (last.length > 1 && measure(`${last}…`, f) > o.maxWidth) last = last.slice(0, -1).trimEnd();
  lines[lines.length - 1] = `${last}…`;
  return result(size, lines, true);
}

// Zeilen eines Fit zeichnen; top ist die Oberkante des Textblocks
export function lines(f: Fit, x: number, top: number, weight: Weight, attrs = "", spacing?: number): string {
  const step = f.size * f.lineHeight;
  // Grundlinie: Versalhöhe von Inter ≈ 0,73 em, mittig im Zeilenkasten
  const base = top + step / 2 + f.size * 0.36;
  return f.lines.map((l, i) => textEl(l, x, Number((base + i * step).toFixed(2)), { size: f.size, weight, spacing }, attrs)).join("");
}
