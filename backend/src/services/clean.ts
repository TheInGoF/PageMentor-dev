/**
 * Chapter cleanup for TTS-ready texts.
 *
 * Three stages, all deterministic (no LLM inference):
 *   1. normalizeUnicode(text) — NFC normalization, ligature expansion,
 *      strip soft hyphens / zero-width chars, flatten non-breaking spaces.
 *   2. stripBoilerplate(pages) — frequency analysis over the top/bottom
 *      lines of each page for repeated headers/footers/watermarks.
 *   3. cleanForReading(text) — regex filters for page numbers, captions,
 *      inline references, hyphenation, ISBN/DOI/URL lines, course-code
 *      headers, whitespace.
 *
 * The pipeline calls stripBoilerplate (which in turn invokes
 * cleanForReading) after PDF extraction. Both upper stages are
 * idempotent — applying them multiple times doesn't change the result.
 */

// ---------------------------------------------------------------------------
// Unicode normalization
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

/** Removes/normalizes characters PDF extractors like to leave behind:
 *  - ligature codepoints (ﬁ/ﬀ/ﬃ…) expanded to ASCII letters
 *  - soft hyphen (U+00AD) fully stripped
 *  - zero-width chars (U+200B/200C/200D/FEFF) stripped
 *  - non-breaking space (U+00A0) + thin NBSP (U+202F/2009) → normal space
 *  - NFC normalization: umlauts as a single codepoint rather than
 *    base + combining
 */
export function normalizeUnicode(text: string): string {
  let t = text.normalize("NFC");
  for (const [from, to] of Object.entries(LIGATURES)) {
    t = t.split(from).join(to);
  }
  t = t.replace(/\u00AD/g, "");              // soft hyphen
  t = t.replace(/[\u200B\u200C\u200D\uFEFF]/g, ""); // zero-width chars
  t = t.replace(/[\u00A0\u202F\u2009]/g, " "); // non-breaking / thin spaces
  // Only fold real hyphen codepoints (U+2010 HYPHEN, U+2011
  // NON-BREAKING HYPHEN) to ASCII dash so hyphenation regexes match.
  // Em-dash (U+2014) / en-dash (U+2013) / figure dash (U+2012) are
  // deliberately *not* normalized: they carry distinct meaning in
  // German prose (thought break, range) and would otherwise falsely
  // trigger the word-merge heuristic.
  t = t.replace(/[\u2010\u2011]/g, "-");
  // Strip XML-1.0-invalid control characters. PDF extractors like to
  // leave NUL (U+0000), form feed (U+000C), DEL (U+007F), etc. behind.
  // Edge TTS silently treats such SSML as invalid → 0 bytes. Azure
  // Speech Service never says this was the reason.
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  return t;
}

// ---------------------------------------------------------------------------
// Boilerplate stripping
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
// Per-text regex cleanup
// ---------------------------------------------------------------------------

export function cleanForReading(raw: string): string {
  let t = normalizeUnicode(raw);

  // Page numbers on their own line
  t = t.replace(/^\s*(?:Seite|Page|S\.)\s*\d{1,4}(?:\s*[\/-]\s*\d{1,4})?\s*$/gim, "");
  t = t.replace(/^\s*\d{1,4}\s*$/gm, "");

  // Course-code header lines: "SS2025 · BWL · S. 42" or "WS 2024/25 — Modul XYZ".
  // Only short lines (up to ~80 chars) starting with (WS|SS)\d+.
  t = t.replace(
    /^\s*(?:WS|SS|WiSe|SoSe)\s?\d{2,4}(?:\s*\/\s*\d{2,4})?\s*(?:[–—\-·•|]\s*.{0,60})?\s*$/gim,
    ""
  );

  // ISBN lines: "ISBN: 978-3-..." or just "978-3-12345-678-9"
  t = t.replace(/^\s*ISBN(?:-1[03])?\s*:?\s*[\d\-Xx ]+\s*$/gim, "");
  t = t.replace(/^\s*97[89][\- ]?\d[\- ]?\d{2,5}[\- ]?\d{2,7}[\- ]?[\dXx]\s*$/gm, "");

  // DOI lines and inline DOIs
  t = t.replace(/^\s*DOI\s*:?\s*10\.\d{4,9}\/[^\s]+\s*$/gim, "");

  // URL-only lines (standalone URL on its own line → drop;
  // inline URLs in prose stay untouched).
  t = t.replace(/^\s*https?:\/\/\S+\s*$/gim, "");
  t = t.replace(/^\s*www\.\S+\s*$/gim, "");

  // Full caption lines: "Abbildung 3.1: …", "Tabelle 2 – …", "Fig. 4: …"
  t = t.replace(
    /^\s*(?:Abbildung|Abb\.|Bild|Tabelle|Tab\.|Figure|Fig\.|Table)\s*\d+(?:[.\-]\d+)*\s*[:.\-–—]\s.*$/gim,
    ""
  );

  // Parenthesized inline references: "(siehe Abb. 3.2)", "(vgl. Tabelle 5)"
  t = t.replace(
    /\(\s*(?:siehe|s\.|vgl\.?|cf\.|see|vgl)\s+(?:Abb(?:ildung)?|Tab(?:elle)?|Fig(?:ure)?|Table|Bild)\.?\s*\d+(?:[.\-]\d+)*\s*\)/gi,
    ""
  );

  // Inline without parens: "siehe Abb. 4.2", "→ Tabelle 7", "vgl. Fig. 3"
  t = t.replace(
    /(?:→|siehe|s\.|vgl\.?|cf\.|see)\s+(?:Abb(?:ildung)?|Tab(?:elle)?|Fig(?:ure)?|Table|Bild)\.?\s*\d+(?:[.\-]\d+)*/gi,
    ""
  );

  // "(Abb. 3.2)" / "(Tab. 5.1)" as bare parenthesized reference
  t = t.replace(
    /\(\s*(?:Abb(?:ildung)?|Tab(?:elle)?|Fig(?:ure)?|Table|Bild)\.?\s*\d+(?:[.\-]\d+)*\s*\)/gi,
    ""
  );

  // Merge end-of-line hyphenation. The hyphen can — depending on the
  // PDF layout — appear with or without spaces before/after
  // ("Verän- derung", "Verän -derung", "Verän - derung"), followed
  // by a line break.
  t = t.replace(/([a-zäöüß])\s*-\s*\n\s*([a-zäöüß])/g, "$1$2");
  // Some extractors replace the line break with a space upfront.
  // Typical hyphenation patterns with lowercase on both sides are
  // almost always real hyphenations (dashes between full words would
  // typographically be "–", which normalizeUnicode does NOT fold to
  // ASCII — that's why the two lookarounds aren't enough without a
  // filter for sufficiently long word fragments).
  t = t.replace(/([a-zäöüß]{2,})\s-\s([a-zäöüß]{2,})/g, "$1$2");

  // Paragraph repair: when a line ends with lowercase / comma and
  // the next line starts with lowercase, this is almost certainly
  // a hard line break mid-sentence → space instead of \n.
  t = t.replace(/([a-zäöüß,])\n([a-zäöüß])/g, "$1 $2");

  // Flatten whitespace and blank lines
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
