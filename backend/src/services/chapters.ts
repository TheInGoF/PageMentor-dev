import { cleanForReading } from "./clean";

export interface DetectedChapter {
  number: number;
  title: string;
  startPage: number;
  endPage: number;
  text: string;
}

const HEADING_PATTERNS: RegExp[] = [
  /^\s*(?:Kapitel|Chapter|Teil|Part|Lektion|Lesson|Unit|Modul)\s+(\d{1,3}|[IVXLC]{1,6})\b\.?\s*[:\-–—]?\s*(.{0,120})$/im,
  /^\s*(\d{1,2})\.\s+([A-ZÄÖÜ][^\n]{3,100})\s*$/m,
];

/**
 * Accepts already boilerplate-cleaned pages.
 * Returns chapters whose `text` is cleanForReading-ed and concatenated.
 */
export function detectChapters(pages: string[]): DetectedChapter[] {
  const headings: Array<{ page: number; number: number; title: string }> = [];
  const usedNumbers = new Set<number>();

  for (let i = 0; i < pages.length; i++) {
    const head = pages[i].split(/\r?\n/).slice(0, 8).join("\n");
    for (const pattern of HEADING_PATTERNS) {
      const m = head.match(pattern);
      if (!m) continue;
      const raw = m[1];
      const num = /^\d+$/.test(raw) ? parseInt(raw, 10) : romanToInt(raw);
      if (!num || usedNumbers.has(num) || num > 999) continue;
      if (headings.length && num !== headings[headings.length - 1].number + 1) continue;
      const title = (m[2] || "").trim().replace(/\s{2,}/g, " ") || `Kapitel ${num}`;
      headings.push({ page: i + 1, number: num, title });
      usedNumbers.add(num);
      break;
    }
  }

  if (headings.length >= 2) {
    return headings.map((h, idx) => {
      const startPage = h.page;
      const endPage = idx + 1 < headings.length ? headings[idx + 1].page - 1 : pages.length;
      const text = cleanForReading(pages.slice(startPage - 1, endPage).join("\n\n"));
      return { number: h.number, title: h.title, startPage, endPage, text };
    });
  }

  // Fallback: gleichmäßige Slices
  const slices = Math.max(1, Math.min(12, Math.ceil(pages.length / 10)));
  const size = Math.max(1, Math.ceil(pages.length / slices));
  const chapters: DetectedChapter[] = [];
  for (let i = 0; i < pages.length; i += size) {
    const startPage = i + 1;
    const endPage = Math.min(i + size, pages.length);
    chapters.push({
      number: chapters.length + 1,
      title: `Abschnitt ${chapters.length + 1}`,
      startPage,
      endPage,
      text: cleanForReading(pages.slice(i, endPage).join("\n\n")),
    });
  }
  return chapters;
}

function romanToInt(s: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let num = 0;
  let prev = 0;
  for (const c of s.toUpperCase().split("").reverse()) {
    const v = map[c] ?? 0;
    if (!v) return 0;
    num += v < prev ? -v : v;
    prev = v;
  }
  return num;
}
