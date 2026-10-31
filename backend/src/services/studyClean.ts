// Bereinigung für Studienhefte (aus dem WBH-RAG-Test übernommen): Symbol-Font, persönliche Daten,
// Formulare und Formelreparatur. Läuft direkt nach Docling, damit Kapitel, Hörbuch, Suche und
// Wissensordner denselben sauberen Text bekommen

// Mathe-Zeichen im Adobe-Symbol-Font ohne Unicode-Zuordnung landen als Private-Use-Zeichen U+F020..U+F0FF
const SYMBOL: Record<number, string> = {
  0x20: " ", 0x21: "!", 0x22: "∀", 0x23: "#", 0x24: "∃", 0x25: "%", 0x26: "&",
  0x27: "∋", 0x28: "(", 0x29: ")", 0x2a: "∗", 0x2b: "+", 0x2c: ",", 0x2d: "−",
  0x2e: ".", 0x2f: "/", 0x3a: ":", 0x3b: ";", 0x3c: "<", 0x3d: "=", 0x3e: ">",
  0x3f: "?", 0x40: "≅",
  0x41: "Α", 0x42: "Β", 0x43: "Χ", 0x44: "Δ", 0x45: "Ε", 0x46: "Φ", 0x47: "Γ",
  0x48: "Η", 0x49: "Ι", 0x4a: "ϑ", 0x4b: "Κ", 0x4c: "Λ", 0x4d: "Μ", 0x4e: "Ν",
  0x4f: "Ο", 0x50: "Π", 0x51: "Θ", 0x52: "Ρ", 0x53: "Σ", 0x54: "Τ", 0x55: "Υ",
  0x56: "ς", 0x57: "Ω", 0x58: "Ξ", 0x59: "Ψ", 0x5a: "Ζ", 0x5b: "[", 0x5c: "∴",
  0x5d: "]", 0x5e: "⊥", 0x5f: "_", 0x60: "‾",
  0x61: "α", 0x62: "β", 0x63: "χ", 0x64: "δ", 0x65: "ε", 0x66: "φ", 0x67: "γ",
  0x68: "η", 0x69: "ι", 0x6a: "ϕ", 0x6b: "κ", 0x6c: "λ", 0x6d: "μ", 0x6e: "ν",
  0x6f: "ο", 0x70: "π", 0x71: "θ", 0x72: "ρ", 0x73: "σ", 0x74: "τ", 0x75: "υ",
  0x76: "ϖ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ", 0x7a: "ζ", 0x7b: "{", 0x7c: "|",
  0x7d: "}", 0x7e: "∼",
  // 0xA1 wäre ϒ, steht in den Heften für ℝ
  0xa0: "€", 0xa1: "ℝ", 0xa2: "′", 0xa3: "≤", 0xa4: "⁄", 0xa5: "∞", 0xa6: "ƒ", 0xab: "↔", 0xac: "←",
  0xad: "↑", 0xae: "→", 0xaf: "↓", 0xb0: "°", 0xb1: "±", 0xb2: "″", 0xb3: "≥",
  0xb4: "×", 0xb5: "∝", 0xb6: "∂", 0xb7: "•", 0xb8: "÷", 0xb9: "≠", 0xba: "≡",
  0xbb: "≈", 0xbc: "…", 0xbd: "|", 0xbe: "—", 0xc0: "ℵ", 0xc1: "ℑ", 0xc2: "ℜ",
  0xc3: "℘", 0xc4: "⊗", 0xc5: "⊕", 0xc6: "∅", 0xc7: "∩", 0xc8: "∪", 0xc9: "⊃",
  0xca: "⊇", 0xcb: "⊄", 0xcc: "⊂", 0xcd: "⊆", 0xce: "∈", 0xcf: "∉", 0xd0: "∠",
  0xd1: "∇", 0xd2: "®", 0xd3: "©", 0xd4: "™", 0xd5: "∏", 0xd6: "√", 0xd7: "⋅",
  0xd8: "¬", 0xd9: "∧", 0xda: "∨", 0xdb: "⇔", 0xdc: "⇐", 0xdd: "⇑", 0xde: "⇒",
  0xdf: "⇓", 0xe0: "◊", 0xe1: "⟨", 0xe2: "®", 0xe3: "©", 0xe4: "™", 0xe5: "∑",
  0xf1: "⟩", 0xf2: "∫", 0xf3: "∫", 0xf4: "", 0xf5: "",
  // Mehrzeilige Klammern: oberes Teil wird zur Klammer, Verlängerungen fallen weg
  0xe6: "(", 0xe7: "", 0xe8: "", 0xe9: "[", 0xea: "", 0xeb: "",
  0xec: "{", 0xed: "", 0xee: "", 0xef: "",
  0xf6: ")", 0xf7: "", 0xf8: "", 0xf9: "]", 0xfa: "", 0xfb: "",
  0xfc: "}", 0xfd: "", 0xfe: "",
};
for (let d = 0x30; d <= 0x39; d++) SYMBOL[d] = String(d - 0x30);

export function mapSymbols(text: string): string {
  if (!/[-]/.test(text)) return text;
  const t = text.replace(/[-]/g, (c) => SYMBOL[c.charCodeAt(0) - 0xf000] ?? c);
  // Derselbe Code steht für ∞ und ℕ bzw. ′ und ℤ; nach ∈ ist es die Zahlenmenge
  return t.replace(/∈\s*∞/g, "∈ ℕ").replace(/∈\s*′/g, "∈ ℤ");
}

// Persönliche Fußzeile, Einsende-Formular, Hinweis- und Rückseiten: gehören weder ins Hörbuch noch in die Suche
// Ganze Zeile samt Umbruch, damit keine Leerzeile bleibt
const PERSONAL_FOOTER = /^.*©\s*HfB,[^\n]*\(\d{5,}\)[^\n]*(?:\n|$)/gm;
const FORM_LINES = /^\s*(?:Name|Vorname|Straße|Postleitzahl und Ort|Matrikel-Nr\.|Studiengangs-Nr\.|Heftkürzel|Druck-Code|Tutor\/-in|Datum|Note|Unterschrift|Einsendeaufgabencode):[ \t]*(?:\n|$)/gm;
const BOILER_PARAS = /^(?:Die in unseren Studienheften verwendeten Personenbezeichnungen|Falls wir in unseren Studienheften auf Seiten im Internet|Bitte reichen Sie Ihre Lösungen über den Online-Campus ein|Copyright by Wilhelm Büchner Hochschule)[^\n]*(?:\n|$)/gm;
const BACK_PAGE = /\n#*\s*Eine Hochschule der Klett Gruppe[\s\S]*$/;

export function stripPersonalData(text: string): string {
  return text.replace(PERSONAL_FOOTER, "").replace(FORM_LINES, "").replace(BOILER_PARAS, "").replace(BACK_PAGE, "\n");
}

export const UNSURE_FORMULA = "[Formel unsicher erkannt]";

// Zeile aus Buchstabensalat (Nachbarzeilen, die das Formelmodell mitgelesen hat)
function isGarbage(seg: string): boolean {
  const toks = seg.split(/\s+/).filter(Boolean);
  const letters = seg.match(/(?<![\\a-zA-Z])[a-zA-ZäöüÄÖÜß](?![a-zA-Z])/g) ?? [];
  return letters.length >= 4 && letters.length >= 0.5 * toks.length;
}

// Typische Halluzinationen: Schaltbild-Beschriftungen als Formel, Ausrichtung ohne Umgebung
export function formulaSuspicious(latex: string): boolean {
  if (/\\intertext|\\varGamma|smallmatrix/.test(latex)) return true;
  if (latex.split(/\s+/).filter(Boolean).length >= 4 && !/[=<>^_+\-]|\\(?:frac|sum|int|lim|cdot|sqrt|left|leq|geq|to)/.test(latex)) return true;
  return latex.includes("&") && !/\\begin\{(cases|aligned|array|matrix|pmatrix)/.test(latex);
}

// Trennstellen, an denen ein fehlendes "=" stehen kann: nicht nach Operator, nicht vor Operator oder Einheit
const SEP = /(?:\\[ ,;:]\s*)+|\\quad\s*/g;
const OPS_AFTER = /^\s*(?:\\cdot|\\times|[+*/,.;)]|\\text|\\quad|\\\\|$)/;
const OPS_BEFORE = /(?:\\cdot|\\times|[+\-*/(=,;]|\\text\s*\{[^}]*\}|\\\\)\s*$/;
const UNIT_AFTER = /^\s*(?:[kmMGnpμ]\s*)?(?:\\Omega|\\mu|\\%|°|%|Ω|VA|Wh|Hz|V|A|S|W|F|H|J|C|s)(?![A-Za-z])/;
const ENUM_PREFIX = /^\s*(?:\\\s*)?\(?\s*[a-z]\s*\)\s*$/;

// Die Formelerkennung lässt "=" oft weg; wie viele es sein müssen, steht in der PDF-Textebene
function restoreEquals(latex: string, orig: string): string {
  const want = (orig.match(/[=\uF03D]/g) ?? []).length;
  let missing = want - (latex.match(/(?<![<>\\!])=/g) ?? []).length;
  if (missing <= 0) return latex;
  latex = latex.replace(/&\s*\\quad/g, (m) => (missing-- > 0 ? "& =" : m));
  if (missing <= 0) return latex;
  const cands = [...latex.matchAll(SEP)].filter((m) => {
    const before = latex.slice(0, m.index);
    const after = latex.slice(m.index! + m[0].length);
    return m.index! > 0 && !OPS_AFTER.test(after) && !OPS_BEFORE.test(before) && !ENUM_PREFIX.test(before) && !(/\d\s*$/.test(before) && UNIT_AFTER.test(after));
  });
  for (const m of cands.slice(-missing).reverse()) latex = latex.slice(0, m.index) + " = " + latex.slice(m.index! + m[0].length);
  return latex;
}

// Formel aus der Formelerkennung reparieren; was danach noch verdächtig ist, wird markiert statt verschwiegen
export function fixFormula(latex: string, orig = ""): string {
  const segs = latex.split(/\s*\\\\\s*/).filter((s) => s.trim());
  const good = segs.filter((s) => !isGarbage(s));
  let t = (good.length ? good : segs.slice(0, 1)).join(" \\\\ ");
  // Buchstabenweise ausgegebene Wörter ("a l s o") werden zu \text{also}
  t = t.replace(/(?<![\\\w{^_])((?:[a-zA-ZäöüÄÖÜß] ){2,}[a-zA-ZäöüÄÖÜß])(?![\w}])/g, (_, w: string) => `\\text{${w.replace(/ /g, "")}}`);
  t = t.replace(/\\text\s*\{\s*(?:for all|für all)\s*\}/g, "\\text{ für alle }");
  t = t.replace(/\\text\s*\{\s*(?:\\\s*)?(?:fir|for|far)(?=[\s}])/g, "\\text {für");
  // "1 0 \Omega" → "10 \Omega", "1 6 , 7" → "16,7"
  for (let i = 0; i < 3; i++) t = t.replace(/(?<=\d) (?=\d)/g, "");
  t = t.replace(/(?<=\d) ([.,]) (?=\d)/g, "$1");
  t = restoreEquals(t, orig);
  t = t.replace(/\s{2,}/g, " ").trim();
  if (t.includes("&") && !t.includes("\\begin") && !t.includes("\\intertext")) t = `\\begin{aligned} ${t} \\end{aligned}`;
  if (formulaSuspicious(t) && !t.includes(UNSURE_FORMULA)) t += ` \\quad \\text{${UNSURE_FORMULA}}`;
  return t;
}

// Markdown aus Docling: Symbole, persönliche Daten, abgesetzte Formeln ($$…$$)
export function cleanStudyMarkdown(md: string): string {
  return stripPersonalData(mapSymbols(md)).replace(/\$\$([\s\S]+?)\$\$/g, (_, f: string) => `$$${fixFormula(f.trim())}$$`);
}
