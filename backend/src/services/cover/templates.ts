// Die drei Cover-Vorlagen als SVG (Einheiten: 500 breit, 800 hoch beim Buchformat, 500 beim Quadrat)
// A: hell und klar · C: Farbfeld in der Modulfarbe · D: zweigeteilt mit der Originalseite oben.
// Feste Maße, damit die Regale in Audiobookshelf ruhig wirken: Kopfhörer immer gleich groß, Titel in fester
// Schriftgröße mit höchstens drei Zeilen (darüber „…“), kein Modulname
import { clamp, lines, measure, textEl, type Block } from "./text";

export type CoverKind = "original" | "subject" | "language";
export type CoverStyle = "a" | "c" | "d";
export type CoverAspect = "book" | "square";
export type CoverSpec = {
  style: CoverStyle;
  aspect: CoverAspect;
  kind: CoverKind;
  title: string;
  // Modulfarbe (Hex) fürs Farbfeld
  color: string | null;
  // Originalseite für die zweigeteilte Vorlage
  image?: { mime: string; bytes: Uint8Array } | null;
};

export const KIND_LABEL: Record<CoverKind, string> = { original: "Hörbuch", subject: "Lernhörbuch", language: "Sprachlern-Hörbuch" };
export const W = 500;
const BLUE = "#0066e0";
const GREEN = "#1c7a5a";
const DARK = "#111827";

export function heightFor(aspect: CoverAspect): number {
  return aspect === "square" ? W : 800;
}

// Pixelmaße der fertigen Datei
export function pixelSize(aspect: CoverAspect): { width: number; height: number } {
  return aspect === "square" ? { width: 1600, height: 1600 } : { width: 1200, height: 1920 };
}

function accent(kind: CoverKind): string {
  return kind === "language" ? GREEN : BLUE;
}

function headphones(x: number, y: number, size: number, color: string, opacity = 1): string {
  const s = (size / 64).toFixed(4);
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})" opacity="${opacity}"><path d="M12 38v-6a20 20 0 0 1 40 0v6" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/><rect x="8" y="36" width="12" height="18" rx="4" fill="${color}"/><rect x="44" y="36" width="12" height="18" rx="4" fill="${color}"/></g>`;
}

function books(x: number, y: number, size: number, color: string): string {
  const s = (size / 24).toFixed(4);
  const spine = (bx: number, by: number) => `<rect x="${bx}" y="${by}" width=".8" height="2.8" rx=".3" fill="#fff" opacity=".55"/>`;
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})"><rect x="2.5" y="15.5" width="19" height="5" rx="1.2" fill="${color}"/><rect x="3.5" y="9.5" width="17" height="5" rx="1.2" fill="${color}" opacity=".7"/><rect x="4.5" y="3.5" width="15" height="5" rx="1.2" fill="${color}" opacity=".45"/>${spine(4.5, 16.6)}${spine(5.5, 10.6)}${spine(6.5, 4.6)}</g>`;
}

// Logo mit Schriftzug, 30 hoch; gibt Breite zurück
function brand(x: number, top: number, color: string): { svg: string; w: number } {
  const f = { size: 22, weight: 700 as const };
  return { svg: books(x, top, 30, color) + textEl("PageMentor", x + 40, top + 23, f, `fill="${color}"`), w: 40 + measure("PageMentor", f) };
}

// Pille mit Großbuchstaben; schrumpft, bis sie in maxWidth passt
function badge(label: string, maxWidth: number, colors: { bg: string; fg: string; border?: string }): { draw: (x: number, top: number) => string; w: number; h: number } {
  const text = label.toUpperCase();
  let size = 20;
  const face = () => ({ size, weight: 700 as const, spacing: 0.06 });
  while (size > 11 && measure(text, face()) + size * 1.8 > maxWidth) size--;
  const w = measure(text, face()) + size * 1.8;
  const h = size * 1.8;
  const border = colors.border ? ` stroke="${colors.border}" stroke-width="2"` : "";
  return {
    w,
    h,
    draw: (x, top) =>
      `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2).toFixed(1)}" fill="${colors.bg}"${border}/>` +
      textEl(text, x + size * 0.9, top + h / 2 + size * 0.36, face(), `fill="${colors.fg}"`),
  };
}

function badgeColors(kind: CoverKind): { bg: string; fg: string } {
  return kind === "original" ? { bg: "#e5e7eb", fg: "#374151" } : { bg: accent(kind), fg: "#fff" };
}

const TITLE_LINES = 3;
const TITLE_LH = 1.15;

function titleBlock(title: string, size: number, maxWidth: number): Block {
  return clamp(title, { size, weight: 700 }, maxWidth, TITLE_LINES, TITLE_LH);
}

// Platz für drei Zeilen, auch wenn der Titel kürzer ist
function titleReserve(size: number): number {
  return TITLE_LINES * size * TITLE_LH;
}

function svgOpen(h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}">`;
}

// Farbhelfer fürs Farbfeld
function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(c: [number, number, number], to: number, k: number): string {
  return `#${c.map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, "0")).join("")}`;
}
function luminance(c: [number, number, number]): number {
  const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

// A: heller Grund, Titel oben, Kopfhörer mittig, Logo und Pille unten
function styleA(s: CoverSpec): string {
  const H = heightFor(s.aspect);
  const square = s.aspect === "square";
  const pad = 54;
  const inner = W - 2 * pad;
  const title = titleBlock(s.title, 36, inner);
  const bottomH = 36;
  const bottomTop = H - pad - bottomH;
  const icon = square ? 150 : 240;
  const iconTop = (pad + titleReserve(36) + 16 + bottomTop - 16) / 2 - icon / 2;
  const logo = brand(pad, H - pad - 30, DARK);
  const pill = badge(KIND_LABEL[s.kind], inner - logo.w - 16, badgeColors(s.kind));
  return (
    svgOpen(H) +
    `<rect width="${W}" height="${H}" fill="#fbf8f1"/>` +
    lines(title, pad, pad, 700, `fill="${DARK}"`) +
    headphones((W - icon) / 2, iconTop, icon, accent(s.kind)) +
    logo.svg +
    pill.draw(W - pad - pill.w, bottomTop + bottomH - pill.h) +
    "</svg>"
  );
}

// C: Farbfeld in der Modulfarbe, Logo und Pille oben, Kopfhörer mittig, Titel unten (an der Unterkante)
function styleC(s: CoverSpec): string {
  const H = heightFor(s.aspect);
  const square = s.aspect === "square";
  const pad = 54;
  const inner = W - 2 * pad;
  const base = rgb(s.color ?? "") ?? rgb("#1565c0")!;
  const light = luminance(base) > 0.45;
  const fg = light ? DARK : "#ffffff";
  const title = titleBlock(s.title, 36, inner);
  const titleTop = H - pad - title.height;
  const rowH = 36;
  const icon = square ? 150 : 280;
  const iconTop = (pad + rowH + 16 + H - pad - titleReserve(36) - 16) / 2 - icon / 2;
  const logo = brand(pad, pad + (rowH - 30) / 2, fg);
  const pill = badge(KIND_LABEL[s.kind], inner - logo.w - 16, { bg: light ? "rgba(17,24,39,.08)" : "rgba(255,255,255,.18)", fg, border: light ? "rgba(17,24,39,.5)" : "rgba(255,255,255,.6)" });
  return (
    svgOpen(H) +
    `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W * 0.35}" y2="${H}"><stop offset="0" stop-color="${mix(base, 0, 0.45)}"/><stop offset=".6" stop-color="${mix(base, 0, 0)}"/><stop offset="1" stop-color="${mix(base, 255, 0.18)}"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#g)"/>` +
    logo.svg +
    pill.draw(W - pad - pill.w, pad + (rowH - pill.h) / 2) +
    headphones((W - icon) / 2, iconTop, icon, fg, 0.9) +
    lines(title, pad, titleTop, 700, `fill="${fg}"`) +
    "</svg>"
  );
}

// D: Originalseite oben (angeschnitten), darunter Titel, Art und Logo
function styleD(s: CoverSpec): string {
  const H = heightFor(s.aspect);
  const square = s.aspect === "square";
  const imgH = Math.round(H * (square ? 0.5 : 0.54));
  const padX = square ? 36 : 44;
  const padY = square ? 24 : 36;
  const size = square ? 28 : 32;
  const title = titleBlock(s.title, size, W - 2 * padX);
  const titleTop = imgH + 6 + padY;
  const kindH = square ? 28 : 36;
  const kindTop = titleTop + titleReserve(size) + (square ? 12 : 18);
  const kindFace = { size: square ? 20 : 24, weight: 700 as const };
  const image = s.image
    ? `<image href="data:${s.image.mime};base64,${Buffer.from(s.image.bytes).toString("base64")}" x="0" y="0" width="${W}" height="${imgH}" preserveAspectRatio="xMidYMin slice"/>`
    : `<rect width="${W}" height="${imgH}" fill="#eef1f5"/>` + headphones(W / 2 - imgH * 0.3, imgH * 0.2, imgH * 0.6, "#c3cad5");
  return (
    svgOpen(H) +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    image +
    `<rect x="0" y="${imgH}" width="${W}" height="6" fill="${accent(s.kind)}"/>` +
    lines(title, padX, titleTop, 700, `fill="${DARK}"`) +
    headphones(padX, kindTop, kindH, accent(s.kind)) +
    textEl(KIND_LABEL[s.kind], padX + kindH + 12, kindTop + kindH / 2 + kindFace.size * 0.36, kindFace, `fill="${accent(s.kind)}"`) +
    brand(padX, H - padY - 30, DARK).svg +
    "</svg>"
  );
}

export function coverSvg(s: CoverSpec): string {
  if (s.style === "a") return styleA(s);
  if (s.style === "c") return styleC(s);
  return styleD(s);
}
