// Was keine Aussprachefehler sind: Whisper schreibt Zahlen als Ziffern, Abkürzungen kurz, buchstabierte Namen
// zusammen, Komposita mal getrennt, mal zusammen, und ist bei Einzelbuchstaben (Formelzeichen) und am Satzanfang
// „unsicher“. Solche Befunde fliegen raus; übrig bleiben verschluckte Stellen und deutlich anders gesprochene Wörter

const NUM: Record<string, string> = {
  null: "0", eins: "1", ein: "1", eine: "1", einer: "1", zwei: "2", drei: "3", vier: "4", fünf: "5", sechs: "6", sieben: "7", acht: "8", neun: "9",
  zehn: "10", elf: "11", zwölf: "12", zwanzig: "20", dreißig: "30", vierzig: "40", fünfzig: "50", sechzig: "60", siebzig: "70", achtzig: "80",
  neunzig: "90", hundert: "100", tausend: "1000", erstens: "1", zweitens: "2", drittens: "3", viertens: "4", fünftens: "5", komma: ",", prozent: "%",
  minus: "-", plus: "+", mal: "x", hoch: "^", halb: "", einhalb: "", zweien: "2", sechseins: "61",
};
const LETTER: Record<string, string> = {
  a: "a", beh: "b", be: "b", zeh: "c", ze: "c", deh: "d", de: "d", eh: "e", eff: "f", geh: "g", ge: "g", hah: "h", ha: "h", i: "i", jott: "j",
  kah: "k", ka: "k", ell: "l", emm: "m", enn: "n", o: "o", peh: "p", pe: "p", kuh: "q", err: "r", er: "r", ess: "s", es: "s", teh: "t", te: "t",
  u: "u", fau: "v", weh: "w", we: "w", ix: "x", ypsilon: "y", zett: "z",
};
const ABBR: Array<[RegExp, string]> = [
  [/\bz\s*\.?\s*b\s*\./g, "zum beispiel"],
  [/\bd\s*\.?\s*h\s*\./g, "das heißt"],
  [/\bbzw\s*\./g, "beziehungsweise"],
  [/\busw\s*\./g, "und so weiter"],
  [/\bu\s*\.?\s*a\s*\./g, "unter anderem"],
  [/\bca\s*\./g, "circa"],
  [/\bgl\s*\./g, "gleichung"],
];

// Vergleichsform: klein, Abkürzungen ausgeschrieben, Zahlwörter und buchstabierte Namen zusammengezogen,
// Leerzeichen und Satzzeichen weg, c/k und ph/f vereinheitlicht
export function compareForm(s: string): string {
  let t = s.toLowerCase().normalize("NFC");
  for (const [re, to] of ABBR) t = t.replace(re, to);
  const words = t.split(/[\s\-–_/(),.:;!?„“"'{}]+/).filter(Boolean);
  const out = words.map((w) => NUM[w] ?? LETTER[w] ?? w);
  return out
    .join("")
    .replace(/[^\p{L}\p{N}%+^x-]/gu, "")
    .replace(/ph/g, "f")
    .replace(/c/g, "k")
    .replace(/ß/g, "ss");
}

function dist(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const letters = (s: string) => s.replace(/[^\p{L}]/gu, "");
// Nur Formelzeichen, Einzelbuchstaben, Ziffern: Whisper hört das nicht verlässlich
const symbolic = (s: string) => s.split(/\s+/).filter(Boolean).every((w) => letters(w).length <= 2 || /\d/.test(w));

export function isNoise(f: { kind: string; expected: string; heard: string }): boolean {
  if (f.kind === "unsure") return true;
  const e = f.expected.trim();
  const h = f.heard.trim();
  if (!letters(e) && !letters(h)) return true;
  // Kurze verschluckte oder zusätzliche Stellen sind fast immer Hörfehler von Whisper
  if (f.kind === "extra") return letters(h).length < 4 || symbolic(h);
  if (f.kind === "missing") return e.split(/\s+/).length < 2 && letters(e).length < 5 ? true : symbolic(e);
  if (symbolic(e) || symbolic(h)) return true;
  const ce = compareForm(e);
  const ch = compareForm(h);
  if (ce === ch) return true;
  // Ein Buchstabe Unterschied (wider/wieder) oder nur eine andere Endung (Information/Informationen)
  if (dist(ce, ch) <= 1) return true;
  if ((ce.startsWith(ch) || ch.startsWith(ce)) && Math.abs(ce.length - ch.length) <= 2 && Math.min(ce.length, ch.length) >= 5) return true;
  // Viele Zahlen in einer Stelle („zwei Komma drei zwei“ ↔ „2 ,32“): Ziffern weg, Rest vergleichen
  const ne = ce.replace(/[\d,%+^x-]/g, "");
  const nh = ch.replace(/[\d,%+^x-]/g, "");
  return ne === nh;
}
