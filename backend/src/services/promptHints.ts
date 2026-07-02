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
 *
 * Two formula strategies depending on the output medium:
 *  - "text" (cards, summaries, tutor): reconstruct broken formulas in
 *    LaTeX so they render properly on screen.
 *  - "audio": the output is SPOKEN — LaTeX is unspeakable and violates
 *    the TTS character allowlist. Broken formulas are described in
 *    plain words (what the formula states), never rebuilt in notation.
 */

const WATERMARK_DE = `BEREINIGUNGS-REGELN für den eingegebenen Text:
- IGNORIERE Watermarks und Kopf-/Fußzeilen: "WILHELM BÜCHNER HOCHSCHULE", "wbh", "WBH", "@"-Logo-Token, einzelstehende Hochschul-/Studiengangs-Kürzel auf eigener Zeile, "Vertraulich", "Entwurf", "DRAFT". Tauchen die im Eingabetext auf, gehören sie NICHT in dein Output.
- IGNORIERE freistehende Seitenzahlen und Glyph-Reste (einzelne "@" oder Logo-Codes wie "/g94").`;

const WATERMARK_EN = `CLEANUP RULES for the input text:
- IGNORE watermarks and headers/footers: "WILHELM BÜCHNER HOCHSCHULE", "wbh", "WBH", "@"-logo tokens, isolated university/program abbreviations on their own line, "Confidential", "Draft", "DRAFT". If they appear in the input, they do NOT belong in your output.
- IGNORE standalone page numbers and glyph fragments (lone "@" characters or logo codes like "/g94").`;

const FORMULA_TEXT_DE = `- FORMELN: wenn die Extraktion Subscripts/Operatoren zerlegt hat ("x 1" statt "x_1", "P ( x i  0.5)" statt "P(x_i)=0.5"), rekonstruiere sie in LaTeX-Notation ($x_1$, $P(x_i)=0.5$, $\\sum_{i=1}^{n}$). Wenn eine Formel nach Rekonstruktion zu mehrdeutig ist, lass sie weg statt sie verstümmelt zu übernehmen.`;

const FORMULA_TEXT_EN = `- FORMULAS: if the extraction broke up subscripts/operators ("x 1" instead of "x_1", "P ( x i  0.5)" instead of "P(x_i)=0.5"), reconstruct them in LaTeX ($x_1$, $P(x_i)=0.5$, $\\sum_{i=1}^{n}$). If a formula is too ambiguous after reconstruction, drop it rather than carry a mangled version forward.`;

const FORMULA_AUDIO_DE = `- ZERSTÜCKELTE FORMELN: wenn die Extraktion eine Formel zerlegt hat ("x 1" statt x_1, "P ( x i  0.5)" statt P(x_i)=0.5), rekonstruiere KEINE Notation und KEIN LaTeX — dein Output wird gesprochen. Erschließe stattdessen die Aussage der Formel aus dem Kontext und beschreibe sie in einem normalen deutschen Satz (siehe Formel-Sektion des Hauptprompts). Wenn die Aussage nach Rekonstruktion zu mehrdeutig bleibt, lass das Fragment ersatzlos weg statt verstümmelte Zeichenketten zu übernehmen.`;

const FORMULA_AUDIO_EN = `- MANGLED FORMULAS: if the extraction broke up a formula ("x 1" instead of x_1, "P ( x i  0.5)" instead of P(x_i)=0.5), do NOT rebuild notation and NO LaTeX — your output will be spoken. Instead, infer what the formula states from context and describe it in a plain sentence (see the formula section of the main prompt). If the statement stays ambiguous after reconstruction, drop the fragment entirely rather than carry mangled character soup forward.`;

export type CleanupContext = "text" | "audio";

export function cleanupHints(
  lang: "de" | "en",
  context: CleanupContext = "text"
): string {
  if (lang === "de") {
    return `${WATERMARK_DE}\n${context === "audio" ? FORMULA_AUDIO_DE : FORMULA_TEXT_DE}`;
  }
  return `${WATERMARK_EN}\n${context === "audio" ? FORMULA_AUDIO_EN : FORMULA_TEXT_EN}`;
}
