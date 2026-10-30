// Kapitel aus Docling-Überschriften bilden und einordnen
// Grenze: kleinste Überschriften-Ebene, die mindestens dreimal vorkommt
import type { ChapterKind, DoclingSection, DoclingTextItem, DoclingDocumentJson } from "./types";

// Nummerierte Überschrift erkennen, liefert die Tiefe
// Nach der Nummer muss ein Wort folgen: Tabellenzeilen wie "1111 1110." sind keine Überschrift
export function numberedHeadingDepth(title: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)*)\s+(?=.*\p{L}{3,})\S/u.exec(title);
  if (!m) return null;
  return m[1].split(".").length;
}

// Titel, die ohne Nummer eigene Kapitel sind, mit ihrer Art
const KNOWN_SECTION_TITLES: Array<{ pattern: RegExp; kind: ChapterKind }> = [
  { pattern: /^vorwort$/i, kind: "meta" },
  { pattern: /^einleitung$/i, kind: "meta" },
  { pattern: /^inhaltsverzeichnis$/i, kind: "index" },
  { pattern: /^(abbildungs|tabellen|sachwort|stichwort)verzeichnis$/i, kind: "index" },
  { pattern: /^glossar$/i, kind: "index" },
  { pattern: /^(literaturverzeichnis|literatur|bibliografie|quellen)$/i, kind: "references" },
  { pattern: /^(verwendete|empfohlene)\s+literatur$/i, kind: "references" },
  { pattern: /^internet[\s-]?links$/i, kind: "references" },
  { pattern: /^zusammenfassung$/i, kind: "summary" },
  { pattern: /^aufgaben\s+zur\s+selbst(überprüfung|kontrolle)$/i, kind: "self_check" },
  { pattern: /^lösungen\s+der\s+übungen/i, kind: "solutions" },
  { pattern: /^lösungen\s+der\s+aufgaben/i, kind: "solutions" },
  // Einsendeaufgaben, auch mit ESA-Zusatz oder Heftnummer
  { pattern: /einsendeaufgabe/i, kind: "self_check" },
  { pattern: /\besa\s*\d|^\s*esa\b/i, kind: "self_check" },
  // Allgemeine Verzeichnisse
  { pattern: /\bverzeichnis$/i, kind: "index" },
];

// Inline-Marker wie Beispiel, Übung, Tab., Abb.: kein eigenes Kapitel
function isInlineMarker(title: string): boolean {
  return /^(beispiel|übung|aufgabe|tab\.|tabelle|abb\.|abbildung|fig\.|figure|tab|merksatz|hinweis|tipp)\s*\d/i.test(
    title.trim()
  );
}

// Abschnitt anhand des Titels einordnen
export function classifyKind(title: string, numberedDepth: number | null): ChapterKind {
  const t = title.trim();
  for (const { pattern, kind } of KNOWN_SECTION_TITLES) {
    if (pattern.test(t)) return kind;
  }
  // Nummerierte Kapitel sind Lerninhalt
  if (numberedDepth != null) return "content";
  return "other";
}

// Grenzen-Modus: nummerierte Hauptkapitel bevorzugt, sonst Docling-Ebene
function analyzeHeadings(items: DoclingTextItem[]): {
  useNumbered: boolean;
  numberedDepthCutoff: number;   // only relevant when useNumbered
  fallbackLevel: number;
} {
  let numberedDepth1 = 0;
  const levelCounts = new Map<number, number>();
  for (const it of items) {
    if (it.label !== "section_header" && it.label !== "title") continue;
    const title = (it.text ?? "").trim();
    if (!title || isInlineMarker(title)) continue;
    const depth = numberedHeadingDepth(title);
    if (depth === 1) numberedDepth1++;
    const lvl = typeof it.level === "number" && it.level > 0 ? it.level : 1;
    levelCounts.set(lvl, (levelCounts.get(lvl) ?? 0) + 1);
  }
  const useNumbered = numberedDepth1 >= 3;
  const fallbackLevel =
    [...levelCounts.entries()]
      .filter(([, n]) => n >= 3)
      .sort(([a], [b]) => a - b)[0]?.[0] ?? 1;
  return { useNumbered, numberedDepthCutoff: 1, fallbackLevel };
}

export function buildSections(
  doc: DoclingDocumentJson,
  pageCount: number,
  fullMarkdown: string
): DoclingSection[] {
  const items = doc.texts ?? [];
  if (items.length === 0) {
    return [
      {
        number: 1,
        title: "Dokument",
        startPage: 1,
        endPage: Math.max(1, pageCount),
        text: fullMarkdown,
        kind: "content",
      },
    ];
  }

  const heur = analyzeHeadings(items);
  const sections: Array<{
    title: string;
    startPage: number;
    endPage: number;
    parts: string[];
    kind: ChapterKind;
  }> = [];
  let cur: (typeof sections)[number] | null = null;

  // Beginnt hier ein neues Kapitel?
  const isChapterBoundary = (item: DoclingTextItem): boolean => {
    if (item.label !== "section_header" && item.label !== "title") return false;
    const title = (item.text ?? "").trim();
    if (!title) return false;
    // Inline-Marker nie als eigenes Kapitel
    if (isInlineMarker(title)) return false;

    // Bekannte Sondertitel immer als Grenze
    if (KNOWN_SECTION_TITLES.some((k) => k.pattern.test(title))) return true;

    if (heur.useNumbered) {
    // Nur nummerierte Hauptkapitel
      const depth = numberedHeadingDepth(title);
      return depth !== null && depth <= heur.numberedDepthCutoff;
    }

    // Fallback: Docling-Ebene ≤ Grenzwert
    const lvl = typeof item.level === "number" && item.level > 0 ? item.level : 1;
    return lvl <= heur.fallbackLevel;
  };

  for (const item of items) {
    const page = item.prov?.[0]?.page_no;

    if (isChapterBoundary(item)) {
      if (cur) sections.push(cur);
      const title = (item.text ?? "").trim();
      const numberedDepth = numberedHeadingDepth(title);
      cur = {
        title,
        startPage: page ?? (sections.at(-1)?.endPage ?? 1),
        endPage: page ?? (sections.at(-1)?.endPage ?? 1),
        parts: [],
        kind: classifyKind(title, numberedDepth),
      };
      continue;
    }

    if (!cur) continue; // before the first chapter → title page, drop

    const label = item.label ?? "text";
    if (["page_footer", "page_header", "page_number", "caption", "furniture"].includes(label)) {
      continue;
    }
    const text = (item.text ?? "").trim();
    if (!text) continue;

    // Inline-Marker als fetter Block im Kapiteltext, ohne eigene Zeile
    if (item.label === "section_header" || item.label === "title") {
      if (isInlineMarker(text)) {
        cur.parts.push(`**${text}**`);
      } else {
        // Unterüberschrift im Kapitel als ##
        cur.parts.push(`\n## ${text}\n`);
      }
    } else {
      cur.parts.push(text);
    }
    if (page && page > cur.endPage) cur.endPage = page;
  }
  if (cur) sections.push(cur);

  if (sections.length === 0) {
    return [
      {
        number: 1,
        title: "Dokument",
        startPage: 1,
        endPage: Math.max(1, pageCount),
        text: fullMarkdown,
        kind: "content",
      },
    ];
  }

  return sections.map((s, idx) => ({
    number: idx + 1,
    title: s.title || `Abschnitt ${idx + 1}`,
    startPage: s.startPage,
    endPage: Math.max(s.startPage, s.endPage),
    text: s.parts.join("\n\n"),
    kind: s.kind,
  }));
}
