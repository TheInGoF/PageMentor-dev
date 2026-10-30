// Deutsche Regeln: Abkürzungen, Einheiten, Symbole, Daten
// Listen angelehnt an repodiac/german_transliterate (CC-BY 4.0), siehe NOTICE
// Keine Zahlwörter: TTS spricht Ziffern zuverlässig
import type { Rule } from "./markdown";

// Akronyme mit 2-3 Großbuchstaben buchstabieren: "BWL" → "B W L"
// Nicht: 4+ Buchstaben, gemischte Schreibung, Einzelbuchstaben
// Römische Zahlen bleiben: "Typ II" nicht als "I I"
export const ROMAN_NUMERAL_RE = /^X{0,3}(?:IX|IV|V?I{0,3})$/;

// Deutsche Buchstabennamen: "T T S" liest F5 als "Tts", "Teh Teh Ess" spricht jede Stimme richtig
export const DE_LETTER_NAMES: Record<string, string> = {
  A: "A", B: "Beh", C: "Zeh", D: "Deh", E: "E", F: "Eff", G: "Geh", H: "Hah", I: "I", J: "Jott", K: "Kah",
  L: "Ell", M: "Emm", N: "Enn", O: "O", P: "Peh", Q: "Kuh", R: "Err", S: "Ess", T: "Teh", U: "U", V: "Fau",
  W: "Weh", X: "Ix", Y: "Üpsilon", Z: "Zett", Ä: "Ä", Ö: "Ö", Ü: "Ü",
};

export const DE_CAPS_ACRONYMS: Rule[] = [
  {
    pattern: /\b([A-ZÄÖÜ]{2,3})\b/g,
    replacement: (match: string) =>
      ROMAN_NUMERAL_RE.test(match) ? match : match.split("").map((ch) => DE_LETTER_NAMES[ch] ?? ch).join(" "),
  },
];

// "und/oder" → "oder": zwei Konjunktionen bringen Qwen ins Stocken
export const DE_AND_OR: Rule[] = [
  { pattern: /\bund\s*\/\s*oder\b/gi, replacement: "oder" },
  { pattern: /\bund\s+oder\b/gi, replacement: "oder" },
];

// Bindestrich zwischen zwei Wörtern → Leerzeichen
// Freistehender Bindestrich war Schleifen-Auslöser
// Min. 2 Buchstaben je Seite: "U-Bahn", "Dipl.-Ing." bleiben
// Ketten wie "A-B-C" in einer Schleife, siehe unten
export const DE_ADJECTIVE_HYPHEN_PATTERN =
  /\b([\p{L}]{2,})-([\p{L}]{2,})\b/gu;
export const DE_ADJECTIVE_HYPHEN: Rule[] = [
  {
    pattern: DE_ADJECTIVE_HYPHEN_PATTERN,
    // Leerzeichen statt Komma: klingt natürlicher
    replacement: "$1 $2",
  },
];

// Ergänzungsketten mit bekanntem Suffix ausschreiben
// "lern-, arbeits- und entwicklungsfähig" → "lernfähig, arbeitsfähig und entwicklungsfähig"
// Unbekanntes Suffix: nur Bindestriche weg
export const DE_KNOWN_SUFFIXES = [
  "fähig", "fähigkeit", "kraft", "los", "weise", "zeit", "raum",
  "bewegung", "arbeit", "kreis", "system", "modell", "ansatz",
  "haltung", "verhalten", "kompetenz", "qualität", "kriterien",
  "werk", "satz", "stand", "sicht", "art", "form", "stil",
];
export const DE_SUFFIX_CHAIN: Rule[] = [
  {
    // "X-, Y- und Z<suffix>" → "Xsuffix, Ysuffix und Zsuffix"
    pattern: /\b([a-zäöüß]{2,})-,\s*([a-zäöüß]{2,})-\s+(und|oder|sowie)\s+([a-zäöüß]{2,})\b/gu,
    replacement: (
      _full: string,
      stem1: string,
      stem2: string,
      conj: string,
      lastWord: string
    ) => {
      const suffix = DE_KNOWN_SUFFIXES.find((s) => lastWord.endsWith(s));
      if (suffix) {
        return `${stem1}${suffix}, ${stem2}${suffix} ${conj} ${lastWord}`;
      }
      // Suffix unbekannt: nur Bindestriche weg
      return `${stem1}, ${stem2} ${conj} ${lastWord}`;
    },
  },
  {
    // Kurzform: "X- und Y<suffix>" → "Xsuffix und Ysuffix"
    pattern: /\b([a-zäöüß]{2,})-\s+(und|oder|sowie)\s+([a-zäöüß]{2,})\b/gu,
    replacement: (
      _full: string,
      stem: string,
      conj: string,
      lastWord: string
    ) => {
      const suffix = DE_KNOWN_SUFFIXES.find((s) => lastWord.endsWith(s));
      if (suffix) {
        return `${stem}${suffix} ${conj} ${lastWord}`;
      }
      // Suffix unbekannt: nur Bindestrich weg
      return `${stem} ${conj} ${lastWord}`;
    },
  },
];

// Ergänzungsstrich vor und/oder/sowie/bzw. entfernen
// "Effizienz- und Effektivitätskriterien" → "Effizienz und Effektivitätskriterien"
// Freistehender Bindestrich lässt Qwen stocken, Hörer ergänzt den Rest
export const DE_HYPHEN_ELLIPSIS: Rule[] = [
  {
    pattern:
      /\b([A-Za-zÄÖÜäöüß]+)-(\s+(?:und|oder|sowie|bzw\.))\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß]+)/g,
    // Leerzeichen statt Komma: klingt natürlicher
    replacement: "$1$2 $3",
  },
];

// Mehrteilige Abkürzungen: z. B., d. h., i. d. R., auch ohne Leerzeichen
export const DE_COMPOUND: Rule[] = [
  { pattern: /\bz\.?\s*B\.?/g, replacement: "zum Beispiel" },
  { pattern: /\bd\.?\s*h\.?/g, replacement: "das heißt" },
  { pattern: /\bu\.?\s*a\.?/g, replacement: "unter anderem" },
  { pattern: /\bu\.?\s*U\.?/g, replacement: "unter Umständen" },
  { pattern: /\bi\.?\s*d\.?\s*R\.?/g, replacement: "in der Regel" },
  { pattern: /\bi\.?\s*A\.?/g, replacement: "im Allgemeinen" },
  { pattern: /\bi\.?\s*d\.?\s*S\.?/g, replacement: "in diesem Sinne" },
  { pattern: /\bi\.?\s*e\.?\s*S\.?/g, replacement: "im engeren Sinne" },
  { pattern: /\bi\.?\s*w\.?\s*S\.?/g, replacement: "im weiteren Sinne" },
  { pattern: /\bu\.?\s*v\.?\s*m\.?/g, replacement: "und vieles mehr" },
  { pattern: /\bu\.?\s*s\.?\s*w\.?/g, replacement: "und so weiter" },
  { pattern: /\bo\.?\s*[äÄ]\.?/g, replacement: "oder ähnliches" },
  { pattern: /\bv\.?\s*Chr\.?/g, replacement: "vor Christus" },
  { pattern: /\bn\.?\s*Chr\.?/g, replacement: "nach Christus" },
  { pattern: /\bz\.?\s*T\.?/g, replacement: "zum Teil" },
  { pattern: /\bi\.?\s*V\.?/g, replacement: "in Vertretung" },
  { pattern: /\bi\.?\s*H\.?\s*v\.?/g, replacement: "in Höhe von" },
  { pattern: /\bi\.?\s*O\.?/g, replacement: "in Ordnung" },
  // Lateinisch
  { pattern: /\bet\s+al\.?/gi, replacement: "und andere" },
  { pattern: /\bibid\.?/gi, replacement: "ebenda" },
  { pattern: /\bebd\.?/g, replacement: "ebenda" },
  { pattern: /\bvgl\.\s*ebd\.?/g, replacement: "vergleiche ebenda" },
];

// Titel vor Großbuchstabe, also vor einem Namen
export const DE_TITLES: Rule[] = [
  // Zusammengesetzte Doktortitel zuerst, sonst bleibt "-Ing." übrig
  { pattern: /\bDr\.\s*-\s*Ing\.\s*/g, replacement: "Doktor-Ingenieur " },
  { pattern: /\bDr\.\s*rer\.\s*nat\.\s*/g, replacement: "Doktor der Naturwissenschaften " },
  { pattern: /\bDr\.\s*rer\.\s*pol\.\s*/g, replacement: "Doktor der Staatswissenschaften " },
  { pattern: /\bDr\.\s*phil\.\s*/g, replacement: "Doktor der Philosophie " },
  { pattern: /\bDr\.\s*med\.\s*/g, replacement: "Doktor der Medizin " },
  { pattern: /\bDr\.\s*jur\.\s*/g, replacement: "Doktor der Rechte " },
  { pattern: /\bDr\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Doktor " },
  { pattern: /\bProf\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Professor " },
  { pattern: /\bDipl\.\s*-?\s*Ing\.?\s+(?=[A-ZÄÖÜ])/g, replacement: "Diplom-Ingenieur " },
  { pattern: /\bDipl\.\s*-?\s*Kfm\.?\s+(?=[A-ZÄÖÜ])/g, replacement: "Diplom-Kaufmann " },
  { pattern: /\bHr\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Herr " },
  { pattern: /\bFr\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Frau " },
  { pattern: /\bSt\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Sankt " },
  { pattern: /\bMag\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Magister " },
];

// Abkürzung + Zahl: S. 42, § 12, Nr. 7; Zahl bleibt Ziffer
export const DE_WITH_NUMBER: Rule[] = [
  { pattern: /§§\s*(\d)/g, replacement: "Paragraphen $1" },
  { pattern: /§\s*(\d)/g, replacement: "Paragraph $1" },
  { pattern: /\bS\.\s*(\d)/g, replacement: "Seite $1" },
  { pattern: /\bBd\.\s*(\d)/g, replacement: "Band $1" },
  { pattern: /\bKap\.\s*(\d)/g, replacement: "Kapitel $1" },
  { pattern: /\bNr\.\s*(\d)/g, replacement: "Nummer $1" },
  { pattern: /\bAufl\.\s*(\d)/g, replacement: "Auflage $1" },
  { pattern: /\bAbb\.\s*(\d)/g, replacement: "Abbildung $1" },
  { pattern: /\bTab\.\s*(\d)/g, replacement: "Tabelle $1" },
];

// Einzelwort-Abkürzungen mit \b-Grenzen
export const DE_SINGLE: Rule[] = [
  { pattern: /\bggf\b\.?/g, replacement: "gegebenenfalls" },
  { pattern: /\bbzw\b\.?/g, replacement: "beziehungsweise" },
  { pattern: /\bvgl\b\.?/g, replacement: "vergleiche" },
  { pattern: /\betc\b\.?/g, replacement: "und so weiter" },
  { pattern: /\bca\b\.?/g, replacement: "circa" },
  { pattern: /\binkl\b\.?/g, replacement: "inklusive" },
  { pattern: /\bexkl\b\.?/g, replacement: "exklusive" },
  { pattern: /\binsb\b\.?/g, replacement: "insbesondere" },
  { pattern: /\bsog\b\.?/g, replacement: "sogenannt" },
  { pattern: /\bbspw\b\.?/g, replacement: "beispielsweise" },
  { pattern: /\bzzgl\b\.?/g, replacement: "zuzüglich" },
  { pattern: /\babzgl\b\.?/g, replacement: "abzüglich" },
  { pattern: /\bMwSt\b\.?/gi, replacement: "Mehrwertsteuer" },
  { pattern: /\bUSt\b\.?/gi, replacement: "Umsatzsteuer" },
  { pattern: /\bMio\b\.?/g, replacement: "Millionen" },
  { pattern: /\bMrd\b\.?/g, replacement: "Milliarden" },
  { pattern: /\bTsd\b\.?/g, replacement: "Tausend" },
  // "ff." → "und folgende", Satzpunkt bleibt am Satzende
  {
    pattern: /(\d)\s*ff\.(?=\s+[A-ZÄÖÜ]|\s*$)/g,
    replacement: "$1 und folgende.",
  },
  { pattern: /(\d)\s*ff\b\.?/g, replacement: "$1 und folgende" },
  // Lernheft-Abkürzungen ohne Zahl
  { pattern: /\bAbb\b\.?/g, replacement: "Abbildung" },
  { pattern: /\bTab\b\.?/g, replacement: "Tabelle" },
  { pattern: /\bKap\b\.?/g, replacement: "Kapitel" },
  { pattern: /\bNr\b\.?/g, replacement: "Nummer" },
  { pattern: /\bBd\b\.?/g, replacement: "Band" },
  { pattern: /\bAufl\b\.?/g, replacement: "Auflage" },
  { pattern: /\bJh\b\.?/g, replacement: "Jahrhundert" },
  { pattern: /\bJg\b\.?/g, replacement: "Jahrgang" },
  { pattern: /\bStd\b\.?/g, replacement: "Stunden" },
];

// Einheiten nach Zahlen, Lookahead statt \b
export const DE_UNITS: Rule[] = [
  // Gewicht
  { pattern: /(\d+(?:[.,]\d+)?)\s*mg(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Milligramm" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*kg(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilogramm" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*g(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Gramm" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*t(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Tonnen" },
  // Länge, Fläche, Volumen
  { pattern: /(\d+(?:[.,]\d+)?)\s*km²/g, replacement: "$1 Quadratkilometer" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*m²/g, replacement: "$1 Quadratmeter" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*cm²/g, replacement: "$1 Quadratzentimeter" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*mm²/g, replacement: "$1 Quadratmillimeter" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*m³/g, replacement: "$1 Kubikmeter" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*cm³/g, replacement: "$1 Kubikzentimeter" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*km(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilometer" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*cm(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Zentimeter" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*mm(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Millimeter" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*m(?![a-zA-ZäöüÄÖÜ²³])/g, replacement: "$1 Meter" },
  // Zeit
  { pattern: /(\d+(?:[.,]\d+)?)\s*ms(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Millisekunden" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*sek(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Sekunden" },
  // Daten
  { pattern: /(\d+(?:[.,]\d+)?)\s*TB(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Terabyte" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*GB(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Gigabyte" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*MB(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Megabyte" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*KB(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilobyte" },
  // Energie
  { pattern: /(\d+(?:[.,]\d+)?)\s*kWh(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilowattstunden" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*MWh(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Megawattstunden" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*kW(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilowatt" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*MW(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Megawatt" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*Hz(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Hertz" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*kHz(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilohertz" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*MHz(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Megahertz" },
];

// Währung und Symbole
export const DE_SYMBOLS: Rule[] = [
  { pattern: /(\d+(?:[.,]\d+)?)\s*€/g, replacement: "$1 Euro" },
  { pattern: /€\s*(\d)/g, replacement: "Euro $1" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*\$/g, replacement: "$1 Dollar" },
  { pattern: /\$\s*(\d)/g, replacement: "Dollar $1" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*£/g, replacement: "$1 Pfund" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*%/g, replacement: "$1 Prozent" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*‰/g, replacement: "$1 Promille" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*°\s*C\b/g, replacement: "$1 Grad Celsius" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*°\s*F\b/g, replacement: "$1 Grad Fahrenheit" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*°(?![a-zA-Z])/g, replacement: "$1 Grad" },
  // Freistehende Rechenzeichen
  { pattern: /≈/g, replacement: " ungefähr " },
  { pattern: /≠/g, replacement: " ungleich " },
  { pattern: /≤/g, replacement: " kleiner gleich " },
  { pattern: /≥/g, replacement: " größer gleich " },
  { pattern: /±/g, replacement: " plus minus " },
  { pattern: /∞/g, replacement: " unendlich " },
  { pattern: /→/g, replacement: " ergibt " },
  { pattern: /⇒/g, replacement: " folgt " },
  { pattern: /↔/g, replacement: " äquivalent zu " },
  { pattern: /⇔/g, replacement: " genau dann wenn " },
  { pattern: /∈/g, replacement: " Element von " },
  { pattern: /∉/g, replacement: " nicht Element von " },
  { pattern: /∑/g, replacement: " Summe " },
  { pattern: /∏/g, replacement: " Produkt " },
  { pattern: /∫/g, replacement: " Integral " },
  { pattern: /∂/g, replacement: " partielle Ableitung " },
  { pattern: /∀/g, replacement: " für alle " },
  { pattern: /∃/g, replacement: " es existiert " },
  // & nur freistehend, sonst Teil einer HTML-Entity
  { pattern: /\s&\s/g, replacement: " und " },
];

// Uhrzeit: 14:30 → 14 Uhr 30
// Nur mit "Uhr" danach oder Präposition davor: "Maßstab 1:50" bleibt
export const DE_TIMES: Rule[] = [
  {
    pattern: /\b(?:(um|ab|bis|gegen|von)\s+)?(\d{1,2}):(\d{2})(\s*Uhr)?\b/g,
    replacement: (
      _m,
      prep: string | undefined,
      h: string,
      min: string,
      uhr: string | undefined
    ) => {
      if (!prep && !uhr) return _m; // no time context — likely a ratio
      const hh = parseInt(h, 10);
      const mm = parseInt(min, 10);
      if (hh > 23 || mm > 59) return _m; // not a time format
      const prefix = prep ? `${prep} ` : "";
      return mm === 0 ? `${prefix}${hh} Uhr` : `${prefix}${hh} Uhr ${mm}`;
    },
  },
];

// Datum: 12.03.2024 → 12. März 2024, nur Monate 1-12
export const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
export const DE_DATES: Rule[] = [
  {
    pattern: /\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\b/g,
    replacement: (_m, d: string, mo: string, y: string) => {
      const dd = parseInt(d, 10);
      const mm = parseInt(mo, 10);
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return _m;
      return `${dd}. ${MONTHS_DE[mm - 1]} ${y}`;
    },
  },
];

// Listenmarker am Zeilenanfang entfernen, nummerierte bleiben
export const DE_LIST_MARKERS: Rule[] = [
  { pattern: /^[\s]*[-*•–][\s]+/gm, replacement: "" },
];

// Lernheft-Köpfe "Übung 1.7:" → "Übung 1.7." + Absatz: klare Pause
// Nur am Zeilenanfang
export const DE_HEADERS: Rule[] = [
  {
    // Kopf mit optionaler Nummer
    pattern:
      /^(Übung|Aufgabe|Beispiel|Definition|Satz|Lemma|Korollar|Theorem|Beweis|Bemerkung|Hinweis|Anmerkung|Achtung|Wichtig|Merksatz|Tipp|Frage|Lösung|Antwort|Vorgehen|Voraussetzung|Behauptung|Folgerung|Übungsaufgabe|Selbsttest)(\s+[\dA-Za-z]+(?:[.\-][\dA-Za-z]+)*)?\s*:\s*/gm,
    replacement: (_, header: string, num?: string) =>
      `${header}${num ?? ""}.\n\n`,
  },
];
