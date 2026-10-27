// Letzter Durchlauf vor dem Speichern: Zeichen entfernen, die TTS stören
// Der Prompt verbietet sie auch, kleine Modelle halten sich nicht immer daran

export function stripProblematicCharsForTts(s: string, lang: "de" | "en" = "de"): string {
  const counts = {
    horizontalRule: (s.match(/^[ \t]*[-=*_]{3,}[ \t]*$/gm) ?? []).length,
    semicolon: (s.match(/;/g) ?? []).length,
    emDash: (s.match(/—/g) ?? []).length,
    enDash: (s.match(/(\S)\s+–\s+(\S)/g) ?? []).length,
    asterisk: (s.match(/\*/g) ?? []).length,
    // Typografische Quotes: lassen Qwen hängen, v. a. vor ! oder ?
    quote: (s.match(/[„""''‚‘‛«»‹›]/g) ?? []).length,
  };

  const cleaned = s
    // Trennlinien raus
    .replace(/^[ \t]*[-=*_]{3,}[ \t]*$/gm, "")
    // Aufzählungs-Sternchen raus
    .replace(/^[ \t]*\*+[ \t]+/gm, "")
    // Hervorhebung *wort* / **wort** → wort
    .replace(/\*{1,3}([^\s*][^*]*?[^\s*])\*{1,3}/g, "$1")
    .replace(/\*{1,3}(\S)\*{1,3}/g, "$1")
    .replace(/\*/g, "")
    .replace(/\s*;\s*/g, ", ")
    .replace(/\s*—\s*/g, ", ")
    // Halbgeviertstrich: zwischen Zahlen "bis", sonst Pause
    .replace(/(\d)\s*–\s*(\d)/g, lang === "de" ? "$1 bis $2" : "$1 to $2")
    .replace(/\s*–\s*/g, ", ")
    // Anführungszeichen ersatzlos
    .replace(/[„""''‚‘‛«»‹›]/g, "")
    .replace(/…/g, "...")
    // Soft-Hyphen
    .replace(/­/g, "")
    // Zero-Width löschen, kein Leerzeichen: sitzt in Wörtern
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    // Sonder-Leerzeichen → normales Leerzeichen
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    // Bullets und Pfeile
    .replace(/[•●◦▪▫►▶◀◁→←↔⇒⇐⇔✓✗]/g, "")
    // Fußnoten-Hochzahlen
    .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰ⁿ]/g, "")
    // Rechenzeichen aussprechen statt löschen
    .replace(/\s*%/g, lang === "de" ? " Prozent" : " percent")
    .replace(/\s*×\s*/g, lang === "de" ? " mal " : " times ")
    .replace(/\s*÷\s*/g, lang === "de" ? " geteilt durch " : " divided by ")
    .replace(/\s*=\s*/g, lang === "de" ? " gleich " : " equals ")
    .replace(/(\d)\s*\+\s*(\d)/g, "$1 plus $2")
    .replace(/(\s)<(\s)/g, lang === "de" ? "$1kleiner als$2" : "$1less than$2")
    .replace(/(\s)>(\s)/g, lang === "de" ? "$1größer als$2" : "$1greater than$2")
    // Rest ohne sprechbare Bedeutung
    .replace(/[§©®™°±~^\\|@#$&+<>]/g, "")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const total =
    counts.horizontalRule +
    counts.semicolon +
    counts.emDash +
    counts.enDash +
    counts.asterisk +
    counts.quote;
  if (total > 0) {
    console.log(
      `[audio-preprocess] stripped ${total} TTS-problem chars: ` +
        `; ×${counts.semicolon}, — ×${counts.emDash}, – ×${counts.enDash}, ` +
        `--- ×${counts.horizontalRule}, * ×${counts.asterisk}, ` +
        `quotes ×${counts.quote}`
    );
  }
  return cleaned;
}
