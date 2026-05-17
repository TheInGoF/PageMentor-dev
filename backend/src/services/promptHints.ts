/**
 * Shared system-prompt fragments injected into every LLM call that
 * processes raw chapter text (audio preprocess, card build, tutor,
 * summaries).
 *
 * Why this lives in one place: scanned/OCR'd Studienheft pages leave a
 * recurring trail of garbage that no single LLM call can fix on its
 * own — Hochschul-watermarks ("WILHELM BÜCHNER HOCHSCHULE", "wbh",
 * "@"-logos), broken formulas ("x 1" instead of "x_1"), spurious
 * single letters from logo glyphs. The frequency-based cleaner in
 * `services/clean.ts` catches the most periodic ones, but anything
 * that bleeds into the middle of a paragraph survives. We tell every
 * downstream Gemma call to ignore them so they don't leak into audio
 * scripts, flashcards, summaries, or tutor answers.
 */

const CLEANUP_DE = `BEREINIGUNGS-REGELN für den eingegebenen Text:
- IGNORIERE Watermarks und Kopf-/Fußzeilen: "WILHELM BÜCHNER HOCHSCHULE", "wbh", "WBH", "@"-Logo-Token, einzelstehende Hochschul-/Studiengangs-Kürzel auf eigener Zeile, "Vertraulich", "Entwurf", "DRAFT". Tauchen die im Eingabetext auf, gehören sie NICHT in dein Output.
- IGNORIERE freistehende Seitenzahlen und Glyph-Reste (einzelne "@" oder Logo-Codes wie "/g94").
- FORMELN: wenn die Extraktion Subscripts/Operatoren zerlegt hat ("x 1" statt "x_1", "P ( x i  0.5)" statt "P(x_i)=0.5"), rekonstruiere sie in LaTeX-Notation ($x_1$, $P(x_i)=0.5$, $\\sum_{i=1}^{n}$). Wenn eine Formel nach Rekonstruktion zu mehrdeutig ist, lass sie weg statt sie verstümmelt zu übernehmen.`;

const CLEANUP_EN = `CLEANUP RULES for the input text:
- IGNORE watermarks and headers/footers: "WILHELM BÜCHNER HOCHSCHULE", "wbh", "WBH", "@"-logo tokens, isolated university/program abbreviations on their own line, "Confidential", "Draft", "DRAFT". If they appear in the input, they do NOT belong in your output.
- IGNORE standalone page numbers and glyph fragments (lone "@" characters or logo codes like "/g94").
- FORMULAS: if the extraction broke up subscripts/operators ("x 1" instead of "x_1", "P ( x i  0.5)" instead of "P(x_i)=0.5"), reconstruct them in LaTeX ($x_1$, $P(x_i)=0.5$, $\\sum_{i=1}^{n}$). If a formula is too ambiguous after reconstruction, drop it rather than carry a mangled version forward.`;

export function cleanupHints(lang: "de" | "en"): string {
  return lang === "de" ? CLEANUP_DE : CLEANUP_EN;
}
