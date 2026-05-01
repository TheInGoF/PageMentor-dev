/**
 * Deterministic expansion of German abbreviations and special
 * characters BEFORE the LLM preprocessor. Saves Ollama work, is
 * consistent, and prevents the LLM from emitting "zum Beispiel"
 * one time and "z. B." the next.
 *
 * Lists inspired by `repodiac/german_transliterate` (CC-BY 4.0,
 * https://github.com/repodiac/german_transliterate) — extended with
 * PageMentor-specific entries (Abb./Tab. for course booklets, §§).
 * See NOTICE for credit.
 *
 * Rule order matters: compound abbreviations (z. B.) must run before
 * titles (Dr.) before single abbreviations (ggf.) before units before
 * symbols. For number-combined rules we only match when a number
 * actually sits before / after.
 *
 * No number spell-out ("5 → fünf") — TTS handles that reliably in
 * both languages, and a JS spell-out would be error-prone and
 * unnecessary.
 */

interface Rule {
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
}

/** Language-agnostic: reshape Markdown syntax for TTS.
 *  Don't just silently strip — translate the structural meaning
 *  into punctuation so TTS prosody (pauses!) is preserved:
 *    - Headings → text with period at the end (sentence pause)
 *    - Bold     → wrapped in commas (short breath pause)
 *    - Italic   → text only (no pause — italic is emphasis,
 *                 voice prosody can't reproduce that)
 *
 *  Edge cases Docling output produces:
 *    - "**Beispiel 1.1:**" at the start of a line is a course
 *      booklet header (bold-wrapped). Becomes "Beispiel 1.1." with
 *      a paragraph break so TTS makes a clean pause.
 *    - "## Foo:" → an appended "." would produce "Foo:." — skip
 *      the second punctuation when the heading already ends with
 *      .:?!/;.
 */
const MARKDOWN_STRIP: Rule[] = [
  // FIRST: bold-wrapped course-booklet headers at the start of a
  // line. They look like "**Beispiel 1.1:**" / "**Übung 3:**" —
  // they appear standalone on a line. We turn them into headers
  // before the generic bold strip "** ... **" turns them into
  // commas and buries the pattern.
  {
    pattern:
      /^\s*\*\*\s*(Übung|Aufgabe|Beispiel|Definition|Satz|Lemma|Korollar|Theorem|Beweis|Bemerkung|Hinweis|Anmerkung|Achtung|Wichtig|Merksatz|Tipp|Frage|Lösung|Antwort|Vorgehen|Voraussetzung|Behauptung|Folgerung|Übungsaufgabe|Selbsttest|Exercise|Problem|Example|Definition|Theorem|Lemma|Corollary|Proof|Remark|Note|Notice|Warning|Tip|Question|Answer|Solution|Approach|Hint)(\s+[\dA-Za-z]+(?:[.\-][\dA-Za-z]+)*)?\s*:?\s*\*\*\s*$/gm,
    replacement: (_, header: string, num?: string) =>
      `${header}${num ?? ""}.\n\n`,
  },
  // Heading: "## 1.1 Titel" → "1.1 Titel." — when the heading
  // already ends with punctuation, do NOT append a second one
  // (otherwise "## Foo:" becomes "Foo:." which confuses TTS).
  {
    pattern: /^#{1,6}\s+(.+?)\s*$/gm,
    replacement: (_, title: string) => {
      const t = title.trim();
      return /[.,:;!?]$/.test(t) ? t : `${t}.`;
    },
  },
  // Horizontal rule → paragraph break (two newlines that the
  // paragraph splitter in tts/segment.ts reads as a paragraph
  // boundary).
  { pattern: /^---+\s*$/gm, replacement: "\n\n" },
  // Strip blockquote marker, keep the text.
  { pattern: /^>\s+/gm, replacement: "" },
  // Code blocks (multi-line) — short announcement with periods
  // to introduce a pause.
  { pattern: /```[\s\S]*?```/g, replacement: " Codeblock. " },
  // Inline code `foo` → just foo, no special character.
  { pattern: /`([^`\n]+)`/g, replacement: "$1" },
  // Bold with commas: ",text," gives TTS a short pause before and
  // after the highlighted segment — whether standalone
  // "** Beispiel 1 **" or inline "Der **Satz** beginnt".
  // Whitespace in the match swallows leading/trailing spaces.
  { pattern: /\*\*\s*([^*\n]+?)\s*\*\*/g, replacement: ", $1," },
  { pattern: /__\s*([^_\n]+?)\s*__/g, replacement: ", $1," },
  // Image ![alt](url) → alt text only.
  { pattern: /!\[([^\]]*)\]\([^)]+\)/g, replacement: "$1" },
  // Link [text](url) → text only.
  { pattern: /\[([^\]]+)\]\([^)]+\)/g, replacement: "$1" },
  // Italic *text* / _text_ — emphasis without pause. Lookbehind
  // so we don't collide with snake_case or "3*x*5".
  { pattern: /(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, replacement: "$1" },
  { pattern: /(?<![\w_])_([^_\n]+)_(?![\w_])/g, replacement: "$1" },
  // Clean up doubled punctuation from our insertions:
  // ",, Text ,," → ", Text,"  |  ".." → "."  |  "((Text)" → "(Text)"
  // The last one is a common Docling artifact in citations.
  { pattern: /,\s*,/g, replacement: "," },
  { pattern: /\.\s*\./g, replacement: "." },
  { pattern: /\(\s*\(/g, replacement: "(" },
  { pattern: /\)\s*\)/g, replacement: ")" },
  // Clean up colon + period at the end of a heading in case the
  // end-punctuation detection in the heading strip fails.
  { pattern: /:\.\s/g, replacement: ": " },
];

/** "und/oder" → "oder". Im Originaltext oft als Schrägstrich-Konstrukt
 *  ("und/oder") oder schon als zwei aufeinanderfolgende Konjunktionen
 *  ("und oder") nach einem missglückten Cleanup. Beides ist für TTS
 *  Mist: zwei Konjunktionen direkt nebeneinander verwirren den Decoder
 *  und triggern bei Qwen-Long-Form Stalls. "oder" allein deckt die
 *  inklusive Bedeutung im Hörfluss völlig ab. */
const DE_AND_OR: Rule[] = [
  { pattern: /\bund\s*\/\s*oder\b/gi, replacement: "oder" },
  { pattern: /\bund\s+oder\b/gi, replacement: "oder" },
];

/** Adjektiv-Bindestrich-Compounds zwischen zwei Kleinbuchstaben-
 *  Wörtern: "technisch-bürokratisch", "kulturell-visionär",
 *  "rot-grün". Phonetisch beim Hörbuch dieselbe Aussprache wie mit
 *  Komma, aber für Qwen-Long-Form deutlich unproblematischer (kein
 *  freistehendes Sonderzeichen). Großgeschriebene Compounds wie
 *  "Maslow-Pyramide" werden NICHT angefasst — das sind echte
 *  Bindestrich-Eigennamen, die bleiben.
 *
 *  Spezialfall: Adjektive nicht aufbrechen wenn das Adjektiv-Paar
 *  ein semantisches Compound bildet ("schwarz-weiß", "rot-grün") —
 *  hier akzeptieren wir den minimalen Aussprache-Unterschied
 *  zwischen "schwarz, weiß" und "schwarz-weiß", weil sich der
 *  Bedeutungsverlust im Hörfluss nicht bemerkbar macht. */
const DE_ADJECTIVE_HYPHEN: Rule[] = [
  {
    pattern: /\b([a-zäöüß]+)-([a-zäöüß]+)\b/g,
    replacement: "$1, $2",
  },
];

/** German "Ergänzungsstrich" — Suffix-Bindestrich vor "und/oder/sowie/bzw."
 *  als Kurzform für gemeinsamen Wortstamm:
 *    "Effizienz- und Effektivitätskriterien"  → "Effizienzkriterien und Effektivitäts­kriterien"
 *  in der Schrift völlig korrekt, aber für TTS phonetisch problematisch:
 *  der freistehende Bindestrich verwirrt den Tokenizer (Pause? Stille?
 *  Bindestrich-Spelling-out?), und Qwen-Long-Form tendiert an dieser
 *  Stelle zu Decoder-Stalls.
 *
 *  Pragmatische Lösung: Bindestrich entfernen und durch Komma ersetzen.
 *  Phonetik > Orthographie — TTS bekommt eine saubere kurze Pause statt
 *  eines mehrdeutigen Sonderzeichens. Bedeutungsverlust („Effizienz" statt
 *  „Effizienz­kriterien") ist im Hörfluss vernachlässigbar, weil der
 *  Hörer den Kontext aus dem zweiten Compound-Wort sofort ergänzt.
 *
 *  Wortmorphologische Vollexpansion ("Effizienzkriterien und
 *  Effektivitätskriterien") wäre ideal, scheitert aber ohne deutsche
 *  Morphologie-Library am sauberen Suffix-Split. */
const DE_HYPHEN_ELLIPSIS: Rule[] = [
  {
    pattern:
      /\b([A-Za-zÄÖÜäöüß]+)-(\s+(?:und|oder|sowie|bzw\.))\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß]+)/g,
    replacement: "$1,$2 $3",
  },
];

/** Multi-token abbreviations with periods: z. B., d. h., i. d. R., …
 *  Also match variants without a space ("z.B.") and without trailing dot. */
const DE_COMPOUND: Rule[] = [
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
  // Lateinisch (im deutschen Text meist englische/lat. Zitate)
  { pattern: /\bet\s+al\.?/gi, replacement: "und andere" },
  { pattern: /\bibid\.?/gi, replacement: "ebenda" },
  { pattern: /\bebd\.?/g, replacement: "ebenda" },
  { pattern: /\bvgl\.\s*ebd\.?/g, replacement: "vergleiche ebenda" },
];

/** Titles before an uppercase letter (= name follows). */
const DE_TITLES: Rule[] = [
  { pattern: /\bDr\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Doktor " },
  { pattern: /\bProf\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Professor " },
  { pattern: /\bDipl\.\s*-?\s*Ing\.?\s+(?=[A-ZÄÖÜ])/g, replacement: "Diplom-Ingenieur " },
  { pattern: /\bDipl\.\s*-?\s*Kfm\.?\s+(?=[A-ZÄÖÜ])/g, replacement: "Diplom-Kaufmann " },
  { pattern: /\bHr\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Herr " },
  { pattern: /\bFr\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Frau " },
  { pattern: /\bSt\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Sankt " },
  { pattern: /\bMag\.\s+(?=[A-ZÄÖÜ])/g, replacement: "Magister " },
];

/** Abbreviation + following number (S. 42, § 12, Nr. 7, …). The number
 *  stays numeric — TTS reads it correctly. */
const DE_WITH_NUMBER: Rule[] = [
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

/** Single-word abbreviations — via `\b` boundaries. */
const DE_SINGLE: Rule[] = [
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
  // Bibliography: "S. 29 ff." / "S. 29ff" → "Seite 29 und folgende".
  // We handle "S." itself above in DE_WITH_NUMBER; here only the
  // trailing ff./ff.
  { pattern: /(\d)\s*ff\b\.?/g, replacement: "$1 und folgende" },
  // Course-booklet specific (without a number — "siehe Abb. rechts")
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

/** Units after numbers. `\b` isn't always enough (e.g. "m" followed
 *  by a letter) — we use a negative lookahead for letters. */
const DE_UNITS: Rule[] = [
  // Weight
  { pattern: /(\d+(?:[.,]\d+)?)\s*mg(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Milligramm" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*kg(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilogramm" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*g(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Gramm" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*t(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Tonnen" },
  // Length / area / volume
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
  // Time (units — clock times handled separately)
  { pattern: /(\d+(?:[.,]\d+)?)\s*ms(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Millisekunden" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*sek(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Sekunden" },
  // Data
  { pattern: /(\d+(?:[.,]\d+)?)\s*TB(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Terabyte" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*GB(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Gigabyte" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*MB(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Megabyte" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*KB(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilobyte" },
  // Energy
  { pattern: /(\d+(?:[.,]\d+)?)\s*kWh(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilowattstunden" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*MWh(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Megawattstunden" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*kW(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilowatt" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*MW(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Megawatt" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*Hz(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Hertz" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*kHz(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilohertz" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*MHz(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Megahertz" },
];

/** Currency and symbols (with and without a leading number). */
const DE_SYMBOLS: Rule[] = [
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
  // Standalone math symbols
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
  // Ampersand only when isolated — otherwise part of HTML entity etc.
  { pattern: /\s&\s/g, replacement: " und " },
];

/** Clock times: 14:30 → 14 Uhr 30, 14:00 → 14 Uhr. */
const DE_TIMES: Rule[] = [
  {
    pattern: /\b(\d{1,2}):(\d{2})(?:\s*Uhr)?\b/g,
    replacement: (_m, h: string, min: string) => {
      const hh = parseInt(h, 10);
      const mm = parseInt(min, 10);
      if (hh > 23 || mm > 59) return _m; // not a time format
      return mm === 0 ? `${hh} Uhr` : `${hh} Uhr ${mm}`;
    },
  },
];

/** Dates: 12.03.2024 → 12. März 2024. Only match when month is 1-12
 *  (otherwise it could be an IP address etc.). */
const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const DE_DATES: Rule[] = [
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

/** List markers at the start of a line: `- foo`, `* foo`, `• foo`
 *  → strip. Numbered ones (1./2./a)) we leave alone — the LLM gets
 *  to decide whether it's a chapter or a list item from context. */
const DE_LIST_MARKERS: Rule[] = [
  { pattern: /^[\s]*[-*•–][\s]+/gm, replacement: "" },
];

/** Course-booklet headers with colon: "Übung 1.7:", "Beispiel 3.2:",
 *  "Definition:", "Satz:" etc. Edge-TTS only makes a short pause for
 *  `:` — but for a header introducing a topic we want a clear break
 *  from the following content. Solution: `:` → `.` plus a paragraph
 *  newline. That way TTS reads the header as its own sentence and
 *  pauses before the content.
 *
 *  Pattern matches only at the start of a line (^…$ with m flag) —
 *  colons inside a sentence ("The following three aspects matter:")
 *  stay untouched, Edge already handles those correctly. */
const DE_HEADERS: Rule[] = [
  {
    // Header with optional numbering: "Übung 1.7:", "Aufgabe 3:",
    // "Beispiel A.2:", "Satz 4.1:" — number is optional.
    pattern:
      /^(Übung|Aufgabe|Beispiel|Definition|Satz|Lemma|Korollar|Theorem|Beweis|Bemerkung|Hinweis|Anmerkung|Achtung|Wichtig|Merksatz|Tipp|Frage|Lösung|Antwort|Vorgehen|Voraussetzung|Behauptung|Folgerung|Übungsaufgabe|Selbsttest)(\s+[\dA-Za-z]+(?:[.\-][\dA-Za-z]+)*)?\s*:\s*/gm,
    replacement: (_, header: string, num?: string) =>
      `${header}${num ?? ""}.\n\n`,
  },
];

const DE_ALL: Rule[] = [
  ...MARKDOWN_STRIP,
  // Headers MUST run after MARKDOWN_STRIP — "## Übung 1.7:" first
  // becomes "Übung 1.7:" and only then matches the header pattern.
  ...DE_HEADERS,
  // Hyphen-ellipsis BEFORE compound abbreviations so the freestanding
  // hyphen doesn't accidentally match other rules.
  ...DE_HYPHEN_ELLIPSIS,
  // "und/oder" → "oder" BEFORE adjective-hyphen, so the "/" doesn't
  // confuse the latter pattern.
  ...DE_AND_OR,
  // Adjective-hyphen between lowercase words → comma. Run before
  // compound abbreviations because some abbreviations contain "-".
  ...DE_ADJECTIVE_HYPHEN,
  ...DE_COMPOUND,
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
  // Collapse double spaces caused by symbol substitutions (the
  // symbols had leading + trailing spaces).
  out = out.replace(/  +/g, " ");
  return out;
}

// ---------------------------------------------------------------------
// English variant (for document.language === "en")
// ---------------------------------------------------------------------

const EN_COMPOUND: Rule[] = [
  { pattern: /\be\.?\s*g\.?/gi, replacement: "for example" },
  { pattern: /\bi\.?\s*e\.?/gi, replacement: "that is" },
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
  { pattern: /\bCh\b\.?/g, replacement: "Chapter" },
  { pattern: /\bNo\b\.?/gi, replacement: "Number" },
  { pattern: /\bVol\b\.?/gi, replacement: "Volume" },
  { pattern: /\bed\b\.?/gi, replacement: "edition" },
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

/** English textbook headers — same idea as DE_HEADERS. */
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

/** Language-agnostic entry point, dispatches by document language. */
export function expandAbbreviations(text: string, language: string): string {
  if (language === "de") return expandGermanAbbreviations(text);
  return expandEnglishAbbreviations(text);
}
