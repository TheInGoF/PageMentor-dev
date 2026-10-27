// Deutsche Abkürzungen vor dem LLM ausschreiben: einheitlich, spart LLM-Arbeit
// Reihenfolge wichtig: Mehrteil → Titel → Einzel → Einheiten → Symbole
import { MARKDOWN_STRIP, type Rule } from "./markdown";
import {
  DE_ADJECTIVE_HYPHEN,
  DE_ADJECTIVE_HYPHEN_PATTERN,
  DE_AND_OR,
  DE_CAPS_ACRONYMS,
  DE_COMPOUND,
  DE_DATES,
  DE_HEADERS,
  DE_HYPHEN_ELLIPSIS,
  DE_LIST_MARKERS,
  DE_SINGLE,
  DE_SUFFIX_CHAIN,
  DE_SYMBOLS,
  DE_TIMES,
  DE_TITLES,
  DE_UNITS,
  DE_WITH_NUMBER,
} from "./deRules";

const DE_ALL: Rule[] = [
  ...MARKDOWN_STRIP,
  // Köpfe nach MARKDOWN_STRIP: "## Übung 1.7:" muss erst "Übung 1.7:" werden
  ...DE_HEADERS,
  // Suffix-Ketten vor Ergänzungsstrich
  ...DE_SUFFIX_CHAIN,
  // Ergänzungsstrich vor den Mehrteil-Abkürzungen
  ...DE_HYPHEN_ELLIPSIS,
  // "und/oder" vor Bindestrich-Regel
  ...DE_AND_OR,
  // Bindestrich vor Mehrteil-Abkürzungen, manche enthalten "-"
  ...DE_ADJECTIVE_HYPHEN,
  ...DE_COMPOUND,
  // Akronyme nach Mehrteil-Abkürzungen, vor Einzel-, Titel- und Zahlregeln
  ...DE_CAPS_ACRONYMS,
  ...DE_TITLES,
  ...DE_WITH_NUMBER,
  ...DE_SINGLE,
  ...DE_UNITS,
  ...DE_SYMBOLS,
  ...DE_TIMES,
  ...DE_DATES,
  ...DE_LIST_MARKERS,
];

export function expandGermanAbbreviations(text: string): string {
  let out = text;
  for (const rule of DE_ALL) {
    out = out.replace(rule.pattern, rule.replacement as string);
  }
  // Bindestrich-Ketten: mehrere Durchläufe bis stabil, max. 5
  for (let i = 0; i < 5; i++) {
    const before = out;
    // Leerzeichen, wie DE_ADJECTIVE_HYPHEN
    out = out.replace(DE_ADJECTIVE_HYPHEN_PATTERN, "$1 $2");
    if (out === before) break;
  }
  // Akronyme nochmal: "ABS-System" ist erst jetzt freistehend
  for (const rule of DE_CAPS_ACRONYMS) {
    out = out.replace(rule.pattern, rule.replacement as string);
  }
  // Doppelte Leerzeichen aus Symbol-Ersetzungen
  out = out.replace(/  +/g, " ");
  return out;
}
