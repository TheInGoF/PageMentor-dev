// Vorhandenes Docling-Markdown in Kapitel zerlegen (statt das PDF erneut umzuwandeln)
import { classifyKind, numberedHeadingDepth } from "../docling/sections";
import type { DoclingExtraction, DoclingSection } from "../docling/types";

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const PAGE_BREAK = /<!--\s*page[_ -]?break\s*-->/i;

interface Heading {
  line: number;
  level: number;
  title: string;
}

// Grenze: nummerierte Hauptkapitel, wenn es mindestens drei gibt, sonst Überschriften der Ebenen 1–2
function boundaries(headings: Heading[]): Heading[] {
  const numbered = headings.filter((h) => numberedHeadingDepth(h.title) === 1);
  if (numbered.length >= 3) return numbered.concat(headings.filter((h) => classifyKind(h.title, null) !== "other" && !numbered.includes(h))).sort((a, b) => a.line - b.line);
  return headings.filter((h) => h.level <= 2);
}

export function markdownSections(md: string, pageCount: number): DoclingSection[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const headings: Heading[] = [];
  lines.forEach((l, i) => {
    const m = HEADING.exec(l);
    if (m) headings.push({ line: i, level: m[1].length, title: m[2].replace(/[*_`]/g, "").trim() });
  });
  // Seiten: Docling-Seitenumbrüche zählen, sonst anteilig schätzen
  const breaksBefore: number[] = [];
  let breaks = 0;
  lines.forEach((l, i) => {
    breaksBefore[i] = breaks;
    if (PAGE_BREAK.test(l)) breaks++;
  });
  const pages = Math.max(1, pageCount || breaks + 1);
  const pageAt = (line: number) => (breaks ? Math.min(pages, breaksBefore[line] + 1) : Math.min(pages, 1 + Math.floor((line / Math.max(1, lines.length)) * pages)));

  const cuts = boundaries(headings);
  if (!cuts.length) return [{ number: 1, title: "Dokument", startPage: 1, endPage: pages, text: md.replace(PAGE_BREAK, "").trim(), kind: "content" }];
  const out: DoclingSection[] = [];
  // Text vor der ersten Überschrift (Titelseite) gehört zum ersten Kapitel
  cuts.forEach((h, i) => {
    const from = i === 0 ? 0 : h.line;
    const to = i + 1 < cuts.length ? cuts[i + 1].line : lines.length;
    const text = lines.slice(from, to).filter((l) => !PAGE_BREAK.test(l)).join("\n").trim();
    out.push({ number: i + 1, title: h.title, startPage: pageAt(from), endPage: Math.max(pageAt(from), pageAt(Math.max(from, to - 1))), text, kind: classifyKind(h.title, numberedHeadingDepth(h.title)) === "other" ? "content" : classifyKind(h.title, numberedHeadingDepth(h.title)) });
  });
  return out;
}

export function extractionFromMarkdown(md: string, pageCount: number): DoclingExtraction {
  return { markdown: md, pageCount: Math.max(1, pageCount), sections: markdownSections(md, pageCount), metadata: { title: null, author: null }, docJson: null };
}
