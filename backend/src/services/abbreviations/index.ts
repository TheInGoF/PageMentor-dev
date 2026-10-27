import { expandGermanAbbreviations } from "./de";
import { expandEnglishAbbreviations } from "./en";

export { expandGermanAbbreviations, expandEnglishAbbreviations };

// Einstieg nach Dokumentsprache
export function expandAbbreviations(text: string, language: string): string {
  if (language === "de") return expandGermanAbbreviations(text);
  return expandEnglishAbbreviations(text);
}
