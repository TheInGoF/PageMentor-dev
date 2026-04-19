/**
 * Deterministische Expansion deutscher Abkürzungen und Sonderzeichen
 * VOR dem LLM-Preprocessor. Spart Ollama Arbeit, ist konsistent, und
 * vermeidet dass der LLM z. B. mal „zum Beispiel" und mal „z. B."
 * rausgibt.
 *
 * Listen inspiriert von `repodiac/german_transliterate` (CC-BY 4.0,
 * https://github.com/repodiac/german_transliterate) — ergänzt um
 * PageMentor-spezifische Einträge (Abb./Tab. für Studienhefte, §§).
 * Credit siehe NOTICE.
 *
 * Reihenfolge der Regeln ist wichtig: Compound-Abkürzungen (z. B.)
 * müssen vor Titel (Dr.) vor Einzel-Abk. (ggf.) vor Einheiten vor
 * Symbolen. Bei Zahl-kombinierten Regeln match nur wenn Zahl wirklich
 * davor / danach steht.
 *
 * Keine Zahl-Spellout ("5 → fünf") — das macht TTS in beiden Sprachen
 * zuverlässig, Spell-out in JS wäre fehlerträchtig und nicht nötig.
 */

interface Rule {
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
}

/** Sprach-agnostisch: Markdown-Syntax TTS-tauglich umformen.
 *  Nicht nur stumm strippen — die strukturelle Bedeutung in
 *  Satzzeichen übersetzen, damit TTS-Prosodie (Pausen!) erhalten
 *  bleibt:
 *    - Headings → Text mit Punkt am Ende (Satz-Pause)
 *    - Bold     → von Kommas umschlossen (kurze Atempause)
 *    - Italic   → nur Text (keine Pause — Italic ist emphasis,
 *                 das kann die Voice-Prosodie nicht nachbilden)
 *
 *  Sonderfälle die Docling-Output mitbringt:
 *    - "**Beispiel 1.1:**" am Zeilenanfang ist ein Studienheft-
 *      Header (Bold gewrapped). Wird zu "Beispiel 1.1." mit Absatz
 *      damit TTS eine saubere Pause macht.
 *    - "## Foo:" → das angehängte "." am Ende würde "Foo:." machen.
 *      Kein doppeltes Satzzeichen wenn das Heading schon mit
 *      .:?!/; endet.
 */
const MARKDOWN_STRIP: Rule[] = [
  // ZUERST: Bold-wrapped Studienheft-Header am Zeilenanfang. Diese
  // sehen aus wie "**Beispiel 1.1:**" / "**Übung 3:**" — kommen
  // alleinstehend in einer Zeile vor. Wir machen sie zu Headern
  // bevor der generische Bold-Strip "** ... **" zu Kommas macht
  // und das Pattern verschüttet.
  {
    pattern:
      /^\s*\*\*\s*(Übung|Aufgabe|Beispiel|Definition|Satz|Lemma|Korollar|Theorem|Beweis|Bemerkung|Hinweis|Anmerkung|Achtung|Wichtig|Merksatz|Tipp|Frage|Lösung|Antwort|Vorgehen|Voraussetzung|Behauptung|Folgerung|Übungsaufgabe|Selbsttest|Exercise|Problem|Example|Definition|Theorem|Lemma|Corollary|Proof|Remark|Note|Notice|Warning|Tip|Question|Answer|Solution|Approach|Hint)(\s+[\dA-Za-z]+(?:[.\-][\dA-Za-z]+)*)?\s*:?\s*\*\*\s*$/gm,
    replacement: (_, header: string, num?: string) =>
      `${header}${num ?? ""}.\n\n`,
  },
  // Heading: "## 1.1 Titel" → "1.1 Titel." — wenn das Heading
  // bereits mit Satzzeichen endet, KEIN doppeltes anhängen
  // (sonst wird "## Foo:" zu "Foo:." was TTS verwirrt).
  {
    pattern: /^#{1,6}\s+(.+?)\s*$/gm,
    replacement: (_, title: string) => {
      const t = title.trim();
      return /[.,:;!?]$/.test(t) ? t : `${t}.`;
    },
  },
  // Horizontal rule → Absatz-Trenner (zwei Newlines die die
  // paragraph-splitter in tts/segment.ts als Absatz-Grenze liest)
  { pattern: /^---+\s*$/gm, replacement: "\n\n" },
  // Blockquote-Marker weg, Text bleibt
  { pattern: /^>\s+/gm, replacement: "" },
  // Code-Blöcke (mehrzeilig) — kurze Ansage mit Punkten für Pause
  { pattern: /```[\s\S]*?```/g, replacement: " Codeblock. " },
  // Inline-Code `foo` → nur foo, kein Sonderzeichen
  { pattern: /`([^`\n]+)`/g, replacement: "$1" },
  // Bold mit Kommas: ",text," gibt TTS eine kurze Pause vor und
  // nach dem hervorgehobenen Abschnitt — egal ob standalone
  // "** Beispiel 1 **" oder inline "Der **Satz** beginnt".
  // Whitespace im match schluckt führende/trailing Spaces.
  { pattern: /\*\*\s*([^*\n]+?)\s*\*\*/g, replacement: ", $1," },
  { pattern: /__\s*([^_\n]+?)\s*__/g, replacement: ", $1," },
  // Image ![alt](url) → nur Alt-Text
  { pattern: /!\[([^\]]*)\]\([^)]+\)/g, replacement: "$1" },
  // Link [text](url) → nur text
  { pattern: /\[([^\]]+)\]\([^)]+\)/g, replacement: "$1" },
  // Italic *text* / _text_ — emphasis ohne Pause. Lookbehind damit
  // wir nicht in snake_case oder "3*x*5" reinfahren.
  { pattern: /(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, replacement: "$1" },
  { pattern: /(?<![\w_])_([^_\n]+)_(?![\w_])/g, replacement: "$1" },
  // Doppelte Satzzeichen nach unseren Einschüben aufräumen:
  // ",, Text ,," → ", Text,"  |  ".." → "."  |  "((Text)" → "(Text)"
  // Letzteres ist ein häufiges Docling-Artefakt bei Citations.
  { pattern: /,\s*,/g, replacement: "," },
  { pattern: /\.\s*\./g, replacement: "." },
  { pattern: /\(\s*\(/g, replacement: "(" },
  { pattern: /\)\s*\)/g, replacement: ")" },
  // Heading-Endung mit Doppelpunkt + Punkt aufräumen für den Fall
  // dass die Endsatzzeichen-Erkennung im Heading-Strip mal versagt.
  { pattern: /:\.\s/g, replacement: ": " },
];

/** Multi-Token-Abkürzungen mit Punkten: z. B., d. h., i. d. R., …
 *  Matchen auch Varianten ohne Space ("z.B.") und ohne Trailing-Dot. */
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

/** Titel vor einem Großbuchstaben (= Name folgt). */
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

/** Abkürzung + nachfolgende Zahl (S. 42, § 12, Nr. 7, …). Die Zahl
 *  bleibt numerisch — TTS liest sie korrekt. */
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

/** Einzelwort-Abk. — per `\b`-Grenzen. */
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
  // Bibliografie: "S. 29 ff." / "S. 29ff" → "Seite 29 und folgende"
  // Das "S." selbst behandeln wir oben in DE_WITH_NUMBER, hier nur
  // das nachfolgende ff./ff
  { pattern: /(\d)\s*ff\b\.?/g, replacement: "$1 und folgende" },
  // Studienheft-typisch (ohne Zahl — „siehe Abb. rechts")
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

/** Einheiten nach Zahlen. `\b` reicht nicht immer (z. B. "m" folgt
 *  auf Buchstabe) — wir nutzen negative Lookahead für Buchstaben. */
const DE_UNITS: Rule[] = [
  // Gewicht
  { pattern: /(\d+(?:[.,]\d+)?)\s*mg(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Milligramm" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*kg(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Kilogramm" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*g(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Gramm" },
  { pattern: /(\d+(?:[.,]\d+)?)\s*t(?![a-zA-ZäöüÄÖÜ])/g, replacement: "$1 Tonnen" },
  // Länge / Fläche / Volumen
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
  // Zeit (Einheiten — Uhrzeiten separat)
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

/** Währung und Symbole (mit und ohne führende Zahl). */
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
  // Math-Symbole standalone
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
  // Ampersand nur wenn isoliert — sonst Teil von HTML-Entity o. ä.
  { pattern: /\s&\s/g, replacement: " und " },
];

/** Uhrzeiten: 14:30 → 14 Uhr 30, 14:00 → 14 Uhr. */
const DE_TIMES: Rule[] = [
  {
    pattern: /\b(\d{1,2}):(\d{2})(?:\s*Uhr)?\b/g,
    replacement: (_m, h: string, min: string) => {
      const hh = parseInt(h, 10);
      const mm = parseInt(min, 10);
      if (hh > 23 || mm > 59) return _m; // kein Zeitformat
      return mm === 0 ? `${hh} Uhr` : `${hh} Uhr ${mm}`;
    },
  },
];

/** Datum: 12.03.2024 → 12. März 2024. Nur matchen wenn Monat 1-12
 *  (sonst könnte es IP-Adresse o. ä. sein). */
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

/** Aufzählungen am Zeilenanfang: `- foo`, `* foo`, `• foo` → weg.
 *  Nummerierte (1./2./a)) lassen wir stehen — Kontext-entscheidung
 *  ob Kapitel oder Aufzählung überlassen wir dem LLM. */
const DE_LIST_MARKERS: Rule[] = [
  { pattern: /^[\s]*[-*•–][\s]+/gm, replacement: "" },
];

/** Studienheft-Header mit Doppelpunkt: "Übung 1.7:", "Beispiel 3.2:",
 *  "Definition:", "Satz:" usw. Edge-TTS macht bei `:` nur eine kurze
 *  Pause — bei einem Header der das Thema einleitet wollen wir aber
 *  eine deutliche Trennung zum folgenden Inhalt. Lösung: `:` → `.`
 *  plus Absatz-Newline. Damit liest TTS den Header als eigenen Satz
 *  und macht danach Atempause vor dem Inhalt.
 *
 *  Pattern matched nur am Zeilenanfang (^…$ mit m-flag) — Doppelpunkte
 *  mitten im Satz ("Folgende drei Aspekte sind wichtig:") bleiben
 *  unangetastet, das macht Edge selbst korrekt. */
const DE_HEADERS: Rule[] = [
  {
    // Header mit optionaler Nummerierung: "Übung 1.7:", "Aufgabe 3:",
    // "Beispiel A.2:", "Satz 4.1:" — Nummer ist optional.
    pattern:
      /^(Übung|Aufgabe|Beispiel|Definition|Satz|Lemma|Korollar|Theorem|Beweis|Bemerkung|Hinweis|Anmerkung|Achtung|Wichtig|Merksatz|Tipp|Frage|Lösung|Antwort|Vorgehen|Voraussetzung|Behauptung|Folgerung|Übungsaufgabe|Selbsttest)(\s+[\dA-Za-z]+(?:[.\-][\dA-Za-z]+)*)?\s*:\s*/gm,
    replacement: (_, header: string, num?: string) =>
      `${header}${num ?? ""}.\n\n`,
  },
];

const DE_ALL: Rule[] = [
  ...MARKDOWN_STRIP,
  // Header MÜSSEN nach MARKDOWN_STRIP laufen — "## Übung 1.7:" wird
  // erst zu "Übung 1.7:" und matched dann das Header-Pattern.
  ...DE_HEADERS,
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
  // Doppelte Leerzeichen die durch Symbol-Ersetzungen entstehen
  // zusammenziehen (die Symbole hatten führende + nachfolgende Space).
  out = out.replace(/  +/g, " ");
  return out;
}

// ---------------------------------------------------------------------
// Englische Variante (für document.language === "en")
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

/** Sprach-agnostische Einstiegsfunktion, dispatched anhand der Doc-Sprache. */
export function expandAbbreviations(text: string, language: string): string {
  if (language === "de") return expandGermanAbbreviations(text);
  return expandEnglishAbbreviations(text);
}
