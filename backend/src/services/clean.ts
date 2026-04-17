/**
 * Kapitel-Cleanup für TTS-taugliche Texte.
 *
 * Drei Stufen, alle deterministisch (keine LLM-Inferenz):
 *   1. normalizeUnicode(text) — NFC-Normalisierung, Ligatur-Entfaltung,
 *      Soft-Hyphen/Zero-Width-Zeichen raus, Non-Breaking-Space flach.
 *   2. stripBoilerplate(pages) — Frequenzanalyse über Top-/Bottom-Zeilen
 *      jeder Seite für wiederkehrende Header/Footer/Watermarks.
 *   3. cleanForReading(text) — Regex-Filter für Seitenzahlen, Captions,
 *      Inline-Verweise, Silbentrennung, ISBN/DOI/URL-Zeilen,
 *      Kurscode-Header, Whitespace.
 *
 * Die Pipeline ruft stripBoilerplate (der intern cleanForReading
 * anstößt) nach der PDF-Extraktion auf. Beide oberen Stufen sind
 * idempotent — mehrfach angewandt ändert das Ergebnis nicht weiter.
 */

// ---------------------------------------------------------------------------
// Unicode-Normalisierung
// ---------------------------------------------------------------------------

const LIGATURES: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB05": "st",
  "\uFB06": "st",
  // Latin small "ct" is rare but shows up in old scans.
  "\u0107\u0323": "ct",
};

/** Entfernt/normalisiert Zeichen, die PDF-Extraktoren gerne hinterlassen:
 *  - Ligatur-Codepoints (ﬁ/ﬀ/ﬃ…) zu ASCII-Buchstaben entfaltet
 *  - Soft-Hyphen (U+00AD) komplett raus
 *  - Zero-Width-Chars (U+200B/200C/200D/FEFF) raus
 *  - Non-Breaking-Space (U+00A0) + schmale NBSP (U+202F/2009) → normales Space
 *  - NFC-Normalisierung: Umlaute als einzelner Codepoint statt Basis+Combining
 */
export function normalizeUnicode(text: string): string {
  let t = text.normalize("NFC");
  for (const [from, to] of Object.entries(LIGATURES)) {
    t = t.split(from).join(to);
  }
  t = t.replace(/\u00AD/g, "");              // soft hyphen
  t = t.replace(/[\u200B\u200C\u200D\uFEFF]/g, ""); // zero-width chars
  t = t.replace(/[\u00A0\u202F\u2009]/g, " "); // non-breaking / thin spaces
  // Nur echte Hyphen-Codepoints (U+2010 HYPHEN, U+2011 NON-BREAKING HYPHEN)
  // zu ASCII-Bindestrich folden — damit Silbentrennungs-Regex greifen.
  // Em-dash (U+2014) / En-dash (U+2013) / Figure-dash (U+2012) werden
  // bewusst *nicht* normalisiert: die haben in deutschem Fließtext eine
  // eigene Bedeutung (Gedankenstrich, Bereich) und würden sonst die
  // Wort-Merge-Heuristik fälschlich triggern.
  t = t.replace(/[\u2010\u2011]/g, "-");
  // XML-1.0-invalide Steuerzeichen rauswerfen. PDF-Extraktoren lassen
  // gerne NUL (U+0000), Form-Feed (U+000C), DEL (U+007F) u. ä. liegen.
  // Edge TTS parst solche SSML stumm als ungültig → 0 Bytes. Azure
  // Speech Service sagt nirgends laut, dass das der Grund war.
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  return t;
}

// ---------------------------------------------------------------------------
// Boilerplate-Stripping
// ---------------------------------------------------------------------------

export function stripBoilerplate(pages: string[]): string[] {
  const normalized = pages.map(normalizeUnicode);
  if (normalized.length === 0) return normalized;
  if (normalized.length < 3) return normalized.map(cleanForReading);

  const freq = new Map<string, number>();
  const candidatesPerPage: Array<Set<string>> = [];

  for (const page of normalized) {
    const lines = page
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const top = lines.slice(0, 3);
    const bottom = lines.slice(-3);
    const set = new Set<string>();
    for (const line of [...top, ...bottom]) {
      if (line.length > 0 && line.length <= 90 && !isMostlyDigits(line)) {
        set.add(line);
      }
    }
    candidatesPerPage.push(set);
    for (const line of set) freq.set(line, (freq.get(line) ?? 0) + 1);
  }

  const threshold = Math.max(3, Math.ceil(normalized.length * 0.3));
  const boilerplate = new Set(
    [...freq.entries()].filter(([, c]) => c >= threshold).map(([l]) => l)
  );

  return normalized.map((page) => {
    let text = page;
    if (boilerplate.size > 0) {
      const lines = text.split(/\r?\n/);
      text = lines.filter((l) => !boilerplate.has(l.trim())).join("\n");
    }
    return cleanForReading(text);
  });
}

// ---------------------------------------------------------------------------
// Regex-Cleanup pro Text
// ---------------------------------------------------------------------------

export function cleanForReading(raw: string): string {
  let t = normalizeUnicode(raw);

  // Seitenzahlen als eigene Zeile
  t = t.replace(/^\s*(?:Seite|Page|S\.)\s*\d{1,4}(?:\s*[\/-]\s*\d{1,4})?\s*$/gim, "");
  t = t.replace(/^\s*\d{1,4}\s*$/gm, "");

  // Kurscode-Kopfzeilen: "SS2025 · BWL · S. 42" oder "WS 2024/25 — Modul XYZ"
  // Nur kurze Zeilen (bis ~80 Zeichen), die mit (WS|SS)\d+ anfangen.
  t = t.replace(
    /^\s*(?:WS|SS|WiSe|SoSe)\s?\d{2,4}(?:\s*\/\s*\d{2,4})?\s*(?:[–—\-·•|]\s*.{0,60})?\s*$/gim,
    ""
  );

  // ISBN-Zeilen: "ISBN: 978-3-..." oder nur "978-3-12345-678-9"
  t = t.replace(/^\s*ISBN(?:-1[03])?\s*:?\s*[\d\-Xx ]+\s*$/gim, "");
  t = t.replace(/^\s*97[89][\- ]?\d[\- ]?\d{2,5}[\- ]?\d{2,7}[\- ]?[\dXx]\s*$/gm, "");

  // DOI-Zeilen und -Inline
  t = t.replace(/^\s*DOI\s*:?\s*10\.\d{4,9}\/[^\s]+\s*$/gim, "");

  // URL-Only-Zeilen (Standalone-URL auf eigener Zeile → droppen,
  // Inline-URLs im Fließtext nicht anfassen).
  t = t.replace(/^\s*https?:\/\/\S+\s*$/gim, "");
  t = t.replace(/^\s*www\.\S+\s*$/gim, "");

  // Ganze Caption-Zeilen: "Abbildung 3.1: …", "Tabelle 2 – …", "Fig. 4: …"
  t = t.replace(
    /^\s*(?:Abbildung|Abb\.|Bild|Tabelle|Tab\.|Figure|Fig\.|Table)\s*\d+(?:[.\-]\d+)*\s*[:.\-–—]\s.*$/gim,
    ""
  );

  // Inline-Verweise mit Klammern: "(siehe Abb. 3.2)", "(vgl. Tabelle 5)"
  t = t.replace(
    /\(\s*(?:siehe|s\.|vgl\.?|cf\.|see|vgl)\s+(?:Abb(?:ildung)?|Tab(?:elle)?|Fig(?:ure)?|Table|Bild)\.?\s*\d+(?:[.\-]\d+)*\s*\)/gi,
    ""
  );

  // Inline ohne Klammern: "siehe Abb. 4.2", "→ Tabelle 7", "vgl. Fig. 3"
  t = t.replace(
    /(?:→|siehe|s\.|vgl\.?|cf\.|see)\s+(?:Abb(?:ildung)?|Tab(?:elle)?|Fig(?:ure)?|Table|Bild)\.?\s*\d+(?:[.\-]\d+)*/gi,
    ""
  );

  // "(Abb. 3.2)" / "(Tab. 5.1)" als reine Klammer-Referenz
  t = t.replace(
    /\(\s*(?:Abb(?:ildung)?|Tab(?:elle)?|Fig(?:ure)?|Table|Bild)\.?\s*\d+(?:[.\-]\d+)*\s*\)/gi,
    ""
  );

  // Silbentrennung am Zeilenende zusammenführen. Der Trennstrich kann — je
  // nach PDF-Layout — mit oder ohne Leerzeichen davor/dahinter auftreten
  // ("Verän- derung", "Verän -derung", "Verän - derung"), gefolgt von
  // einem Zeilenumbruch.
  t = t.replace(/([a-zäöüß])\s*-\s*\n\s*([a-zäöüß])/g, "$1$2");
  // Manche Extraktoren ersetzen den Zeilenumbruch bereits vorab durch ein
  // Leerzeichen. Typische Trennmuster mit Kleinbuchstaben beidseitig sind
  // fast immer echte Silbentrennungen (Bindestriche zwischen Vollwörtern
  // stünden typografisch als „–", die normalizeUnicode bereits zu ASCII
  // zusammenfasst — deshalb reichen die beiden Lookarounds nicht ohne
  // Filter auf ausreichend lange Wortbestandteile).
  t = t.replace(/([a-zäöüß]{2,})\s-\s([a-zäöüß]{2,})/g, "$1$2");

  // Paragraph-Reparatur: Wenn eine Zeile auf Kleinbuchstaben/Komma endet
  // und die nächste mit Kleinbuchstaben startet, ist das fast sicher
  // ein harter Zeilenumbruch mitten im Satz → Leerzeichen statt \n.
  t = t.replace(/([a-zäöüß,])\n([a-zäöüß])/g, "$1 $2");

  // Whitespace & Leerzeilen einebnen
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/ ?\n ?/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.replace(/ {2,}/g, " ");
  t = t.replace(/^\s+|\s+$/g, "");

  return t;
}

function isMostlyDigits(s: string): boolean {
  const digits = s.replace(/\D/g, "").length;
  return digits > 0 && digits / s.length > 0.6;
}
