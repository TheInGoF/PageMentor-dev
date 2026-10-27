// Englische Variante für document.language === "en"
import { MARKDOWN_STRIP, type Rule } from "./markdown";


const EN_COMPOUND: Rule[] = [
  // Beide Punkte Pflicht, sonst werden normale Wörter getroffen
  { pattern: /\be\.\s*g\.(?!\w)/gi, replacement: "for example" },
  { pattern: /\bi\.\s*e\.(?!\w)/gi, replacement: "that is" },
  { pattern: /\bet\s+al\.?/gi, replacement: "and others" },
  { pattern: /\bvs\b\.?/gi, replacement: "versus" },
  { pattern: /\betc\b\.?/gi, replacement: "and so on" },
  { pattern: /\bviz\b\.?/gi, replacement: "namely" },
  { pattern: /\bcf\b\.?/gi, replacement: "compare" },
  { pattern: /\bibid\b\.?/gi, replacement: "in the same place" },
];

const EN_TITLES: Rule[] = [
  { pattern: /\bDr\.\s+(?=[A-Z])/g, replacement: "Doctor " },
  { pattern: /\bProf\.\s+(?=[A-Z])/g, replacement: "Professor " },
  { pattern: /\bMr\.\s+(?=[A-Z])/g, replacement: "Mister " },
  { pattern: /\bMrs\.\s+(?=[A-Z])/g, replacement: "Misses " },
  { pattern: /\bMs\.\s+(?=[A-Z])/g, replacement: "Miz " },
  { pattern: /\bSt\.\s+(?=[A-Z])/g, replacement: "Saint " },
];

const EN_WITH_NUMBER: Rule[] = [
  { pattern: /§§\s*(\d)/g, replacement: "Sections $1" },
  { pattern: /§\s*(\d)/g, replacement: "Section $1" },
  { pattern: /\bp\.\s*(\d)/gi, replacement: "page $1" },
  { pattern: /\bpp\.\s*(\d)/gi, replacement: "pages $1" },
  { pattern: /\bCh\.\s*(\d)/g, replacement: "Chapter $1" },
  { pattern: /\bNo\.\s*(\d)/gi, replacement: "Number $1" },
  { pattern: /\bVol\.\s*(\d)/gi, replacement: "Volume $1" },
  { pattern: /\bFig\.\s*(\d)/gi, replacement: "Figure $1" },
  { pattern: /\bTab\.\s*(\d)/gi, replacement: "Table $1" },
];

const EN_SINGLE: Rule[] = [
  { pattern: /\bapprox\b\.?/gi, replacement: "approximately" },
  { pattern: /\bmax\b\.?/gi, replacement: "maximum" },
  { pattern: /\bmin\b\.?/gi, replacement: "minimum" },
  { pattern: /\bavg\b\.?/gi, replacement: "average" },
  { pattern: /\bFig\b\.?/g, replacement: "Figure" },
  { pattern: /\bTab\b\.?/g, replacement: "Table" },
  { pattern: /\bCh\.(?!\w)/g, replacement: "Chapter" },
  // "No." nur mit Punkt vor Zahl, sonst wird jedes "no" zu "Number"
  { pattern: /\bNo\.(?=\s*\d)/g, replacement: "Number" },
  { pattern: /\bVol\.(?!\w)/gi, replacement: "Volume" },
  { pattern: /\bed\.(?!\w)/g, replacement: "edition" },
];

const EN_UNITS: Rule[] = [
  { pattern: /(\d+(?:\.\d+)?)\s*kg\b/g, replacement: "$1 kilograms" },
  { pattern: /(\d+(?:\.\d+)?)\s*g\b/g, replacement: "$1 grams" },
  { pattern: /(\d+(?:\.\d+)?)\s*km\b/g, replacement: "$1 kilometers" },
  { pattern: /(\d+(?:\.\d+)?)\s*m²/g, replacement: "$1 square meters" },
  { pattern: /(\d+(?:\.\d+)?)\s*m³/g, replacement: "$1 cubic meters" },
  { pattern: /(\d+(?:\.\d+)?)\s*m\b(?![a-zA-Z²³])/g, replacement: "$1 meters" },
  { pattern: /(\d+(?:\.\d+)?)\s*cm\b/g, replacement: "$1 centimeters" },
  { pattern: /(\d+(?:\.\d+)?)\s*mm\b/g, replacement: "$1 millimeters" },
  { pattern: /(\d+(?:\.\d+)?)\s*kWh\b/g, replacement: "$1 kilowatt-hours" },
  { pattern: /(\d+(?:\.\d+)?)\s*MB\b/g, replacement: "$1 megabytes" },
  { pattern: /(\d+(?:\.\d+)?)\s*GB\b/g, replacement: "$1 gigabytes" },
  { pattern: /(\d+(?:\.\d+)?)\s*Hz\b/g, replacement: "$1 hertz" },
  { pattern: /(\d+(?:\.\d+)?)\s*MHz\b/g, replacement: "$1 megahertz" },
];

const EN_SYMBOLS: Rule[] = [
  { pattern: /\$\s*(\d)/g, replacement: "$1 dollars" },
  { pattern: /(\d+(?:\.\d+)?)\s*\$/g, replacement: "$1 dollars" },
  { pattern: /€\s*(\d)/g, replacement: "$1 euros" },
  { pattern: /(\d+(?:\.\d+)?)\s*€/g, replacement: "$1 euros" },
  { pattern: /(\d+(?:\.\d+)?)\s*%/g, replacement: "$1 percent" },
  { pattern: /(\d+(?:\.\d+)?)\s*°\s*C\b/g, replacement: "$1 degrees Celsius" },
  { pattern: /(\d+(?:\.\d+)?)\s*°\s*F\b/g, replacement: "$1 degrees Fahrenheit" },
  { pattern: /(\d+(?:\.\d+)?)\s*°(?![a-zA-Z])/g, replacement: "$1 degrees" },
  { pattern: /≈/g, replacement: " approximately " },
  { pattern: /≠/g, replacement: " not equal to " },
  { pattern: /≤/g, replacement: " less than or equal to " },
  { pattern: /≥/g, replacement: " greater than or equal to " },
  { pattern: /±/g, replacement: " plus or minus " },
  { pattern: /∞/g, replacement: " infinity " },
  { pattern: /→/g, replacement: " yields " },
  { pattern: /⇒/g, replacement: " implies " },
  { pattern: /↔/g, replacement: " is equivalent to " },
  { pattern: /⇔/g, replacement: " if and only if " },
  { pattern: /∈/g, replacement: " in " },
  { pattern: /∉/g, replacement: " not in " },
  { pattern: /∑/g, replacement: " sum " },
  { pattern: /∏/g, replacement: " product " },
  { pattern: /∫/g, replacement: " integral " },
  { pattern: /∂/g, replacement: " partial " },
  { pattern: /∀/g, replacement: " for all " },
  { pattern: /∃/g, replacement: " there exists " },
  { pattern: /\s&\s/g, replacement: " and " },
];

const EN_LIST_MARKERS: Rule[] = [
  { pattern: /^[\s]*[-*•–][\s]+/gm, replacement: "" },
];

// Englische Lehrbuch-Köpfe, wie DE_HEADERS
const EN_HEADERS: Rule[] = [
  {
    pattern:
      /^(Exercise|Problem|Example|Definition|Theorem|Lemma|Corollary|Proof|Remark|Note|Notice|Warning|Tip|Question|Answer|Solution|Approach|Hint|Self-Check)(\s+[\dA-Za-z]+(?:[.\-][\dA-Za-z]+)*)?\s*:\s*/gm,
    replacement: (_, header: string, num?: string) =>
      `${header}${num ?? ""}.\n\n`,
  },
];

const EN_ALL: Rule[] = [
  ...MARKDOWN_STRIP,
  ...EN_HEADERS,
  ...EN_COMPOUND,
  ...EN_TITLES,
  ...EN_WITH_NUMBER,
  ...EN_SINGLE,
  ...EN_UNITS,
  ...EN_SYMBOLS,
  ...EN_LIST_MARKERS,
];

export function expandEnglishAbbreviations(text: string): string {
  let out = text;
  for (const rule of EN_ALL) {
    out = out.replace(rule.pattern, rule.replacement as string);
  }
  out = out.replace(/  +/g, " ");
  return out;
}
