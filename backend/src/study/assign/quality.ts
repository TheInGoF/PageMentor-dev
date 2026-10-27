// Qualitätsprüfung nach der Umwandlung (03_qualitycheck des Studium Makers)

export interface Quality {
  formulaMissing: number;
  // Gegenprobe: erkannte LaTeX-Formeln
  formulaLatex: number;
  reasons: string[];
  // true = ansehen, bevor daraus Material entsteht
  flag: boolean;
}

export function checkQuality(markdown: string, pages: number): Quality {
  const reasons: string[] = [];
  const formulaMissing = (markdown.match(/formula-not-decoded/g) ?? []).length;
  if (formulaMissing) reasons.push(`${formulaMissing} Formeln nicht erkannt`);

  // Inline-Bilder verfälschen jede Textmetrik
  const inline = (markdown.match(/data:image/g) ?? []).length;
  const text = inline ? markdown.replace(/!\[[^\]]*\]\(data:image[^)]*\)/g, "[BILD]") : markdown;
  if (inline) reasons.push(`${inline} Bilder eingebettet`);

  if (pages > 2 && text.length < 500) reasons.push(`nur ${text.length} Zeichen bei ${pages} Seiten`);
  else if (pages > 1 && text.length / pages < 120) reasons.push(`${Math.floor(text.length / pages)} Zeichen je Seite`);

  if (text.length) {
    const nonAscii = [...text].filter((c) => c.charCodeAt(0) > 127).length;
    if (nonAscii / text.length > 0.3) reasons.push(`${Math.floor((nonAscii * 100) / text.length)} % Sonderzeichen`);
  }
  const empty = text.split("| |").length - 1 + (text.split("||").length - 1);
  if (empty > 20) reasons.push(`${empty} leere Tabellenzellen`);

  // OCR-Reste: viele Wortfragmente ohne Vokal
  const words = text.match(/[A-Za-zÄÖÜäöüß]+/g) ?? [];
  if (words.length > 80) {
    const junk = words.filter((w) => w.length > 2 && !/[aeiouäöü]/i.test(w)).length;
    if (junk / words.length > 0.08) reasons.push(`${Math.floor((junk * 100) / words.length)} % Wortfragmente`);
  }
  const formulaLatex = (text.match(/\$[^$\n]{3,}\$|\\frac|\\cdot/g) ?? []).length;
  return { formulaMissing, formulaLatex, reasons, flag: reasons.length > 0 };
}
