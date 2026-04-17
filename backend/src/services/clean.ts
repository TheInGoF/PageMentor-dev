/**
 * Kapitel-Cleanup für TTS-taugliche Texte.
 *
 * Zwei Stufen:
 *   1. stripBoilerplate(pages) — entfernt pro PDF wiederkehrende
 *      Header/Footer/Watermarks per Frequenzanalyse über alle Seiten.
 *   2. cleanForReading(text)  — Regex-Filter für Seitenzahlen, Abbildungs-/
 *      Tabellen-Captions, Inline-Verweise, Silbentrennung, Whitespace.
 *
 * Der Pipeline-Aufruf kombiniert beide: stripBoilerplate zuerst, danach
 * detectChapters, und der pro-Kapitel-Text geht durch cleanForReading.
 */

export function stripBoilerplate(pages: string[]): string[] {
  if (pages.length === 0) return pages;
  if (pages.length < 3) return pages.map(cleanForReading);

  const freq = new Map<string, number>();
  const candidatesPerPage: Array<Set<string>> = [];

  for (const page of pages) {
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

  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));
  const boilerplate = new Set(
    [...freq.entries()].filter(([, c]) => c >= threshold).map(([l]) => l)
  );

  return pages.map((page) => {
    let text = page;
    if (boilerplate.size > 0) {
      const lines = text.split(/\r?\n/);
      text = lines.filter((l) => !boilerplate.has(l.trim())).join("\n");
    }
    return cleanForReading(text);
  });
}

export function cleanForReading(raw: string): string {
  let t = raw;

  // Seitenzahlen als eigene Zeile
  t = t.replace(/^\s*(?:Seite|Page|S\.)\s*\d{1,4}(?:\s*[\/-]\s*\d{1,4})?\s*$/gim, "");
  t = t.replace(/^\s*\d{1,4}\s*$/gm, "");

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

  // Silbentrennung am Zeilenende zusammenführen
  t = t.replace(/([a-zäöüß])-\s*\n\s*([a-zäöüß])/g, "$1$2");

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
