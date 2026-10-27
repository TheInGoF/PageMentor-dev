// Gemeinsamer Regeltyp und Markdown-Umformung

export interface Rule {
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
}

// Markdown für TTS umformen, Struktur als Satzzeichen erhalten
// Überschrift → Punkt am Ende, Fett → Kommas, Kursiv → nur Text
export const MARKDOWN_STRIP: Rule[] = [
  // Zuerst: fette Lernheft-Köpfe wie "**Beispiel 1.1:**" am Zeilenanfang
  {
    pattern:
      /^\s*\*\*\s*(Übung|Aufgabe|Beispiel|Definition|Satz|Lemma|Korollar|Theorem|Beweis|Bemerkung|Hinweis|Anmerkung|Achtung|Wichtig|Merksatz|Tipp|Frage|Lösung|Antwort|Vorgehen|Voraussetzung|Behauptung|Folgerung|Übungsaufgabe|Selbsttest|Exercise|Problem|Example|Definition|Theorem|Lemma|Corollary|Proof|Remark|Note|Notice|Warning|Tip|Question|Answer|Solution|Approach|Hint)(\s+[\dA-Za-z]+(?:[.\-][\dA-Za-z]+)*)?\s*:?\s*\*\*\s*$/gm,
    replacement: (_, header: string, num?: string) =>
      `${header}${num ?? ""}.\n\n`,
  },
  // Überschrift → Text mit Punkt, kein zweites Satzzeichen
  {
    pattern: /^#{1,6}\s+(.+?)\s*$/gm,
    replacement: (_, title: string) => {
      const t = title.trim();
      return /[.,:;!?]$/.test(t) ? t : `${t}.`;
    },
  },
  // Trennlinie → Absatz
  { pattern: /^---+\s*$/gm, replacement: "\n\n" },
  // Zitat-Marker weg, Text bleibt
  { pattern: /^>\s+/gm, replacement: "" },
  // Codeblock → kurze Ansage
  { pattern: /```[\s\S]*?```/g, replacement: " Codeblock. " },
  // Inline-Code → nur der Text
  { pattern: /`([^`\n]+)`/g, replacement: "$1" },
  // Fett → mit Kommas: kurze Pause davor und danach
  { pattern: /\*\*\s*([^*\n]+?)\s*\*\*/g, replacement: ", $1," },
  { pattern: /__\s*([^_\n]+?)\s*__/g, replacement: ", $1," },
  // Bild → nur Alt-Text
  { pattern: /!\[([^\]]*)\]\([^)]+\)/g, replacement: "$1" },
  // Link → nur Text
  { pattern: /\[([^\]]+)\]\([^)]+\)/g, replacement: "$1" },
  // Kursiv → nur Text; Lookbehind schützt snake_case und 3*x*5
  { pattern: /(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, replacement: "$1" },
  { pattern: /(?<![\w_])_([^_\n]+)_(?![\w_])/g, replacement: "$1" },
  // Doppelte Satzzeichen aus unseren Ersetzungen aufräumen
  { pattern: /,\s*,/g, replacement: "," },
  { pattern: /\.\s*\./g, replacement: "." },
  { pattern: /\(\s*\(/g, replacement: "(" },
  { pattern: /\)\s*\)/g, replacement: ")" },
  // Doppelpunkt + Punkt am Überschriftende
  { pattern: /:\.\s/g, replacement: ": " },
];
