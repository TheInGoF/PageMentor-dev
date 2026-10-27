// LaTeX und Markdown in vorlesbaren deutschen Text: „U gleich R mal I“
const GREEK: Record<string, string> = {
  alpha: "Alpha", beta: "Beta", gamma: "Gamma", delta: "Delta", Delta: "Delta", epsilon: "Epsilon", varepsilon: "Epsilon",
  eta: "Eta", theta: "Theta", lambda: "Lambda", mu: "My", pi: "Pi", rho: "Rho", sigma: "Sigma", Sigma: "Summe", tau: "Tau",
  phi: "Phi", varphi: "Phi", omega: "Omega", Omega: "Ohm",
};

const WORDS: Array<[RegExp, string]> = [
  [/\\cdot|\\times/g, " mal "],
  [/\\approx/g, " ungefähr "],
  [/\\(?:leq|le)\b/g, " kleiner gleich "],
  [/\\(?:geq|ge)\b/g, " größer gleich "],
  [/\\neq/g, " ungleich "],
  [/\\pm/g, " plus minus "],
  [/\\parallel/g, " parallel "],
  [/\\infty/g, " unendlich "],
  [/\\(?:to|rightarrow)/g, " gegen "],
  [/\\sum/g, " Summe "],
  [/\\int/g, " Integral "],
  [/\\ln\b/g, " l n "],
  [/\\log\b/g, " Logarithmus "],
  [/\\(?:mathrm|text|mathbf|operatorname)\{([^{}]*)\}/g, " $1 "],
  [/\{,\}/g, ","],
  [/\\[,;!: ]/g, " "],
];

export function latexToSpeech(tex: string): string {
  let s = tex;
  // Innere Brüche zuerst, bis keine mehr übrig sind
  for (let i = 0; i < 5 && /\\[dt]?frac/.test(s); i++) s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, " ($1) durch ($2) ");
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, " Wurzel aus ($1) ");
  for (const [re, w] of WORDS) s = s.replace(re, w);
  s = s.replace(/\\([A-Za-z]+)/g, (_, name: string) => ` ${GREEK[name] ?? name} `);
  s = s
    .replace(/\^\{?2\}?/g, " Quadrat ")
    .replace(/\^\{([^{}]*)\}|\^(\S)/g, (_, a, b) => ` hoch ${a ?? b} `)
    .replace(/_\{([^{}]*)\}|_(\S)/g, (_, a, b) => ` ${a ?? b} `)
    .replace(/=/g, " gleich ")
    .replace(/\+/g, " plus ")
    .replace(/(?<=\s|^)-(?=\s|\w)/g, " minus ")
    .replace(/\//g, " durch ")
    .replace(/[{}]/g, " ")
    // Klammern um ein einzelnes Wort sind beim Vorlesen überflüssig
    .replace(/\(\s*([\wÄÖÜäöüß,]+)\s*\)/g, "$1");
  return s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
}

// Markdown eines Katalog-Eintrags vorlesbar machen
export function markdownToSpeech(md: string): string {
  return md
    .replace(/\$\$([^$]+)\$\$/g, (_, t) => `${latexToSpeech(t)}.`)
    .replace(/\$([^$]+)\$/g, (_, t) => latexToSpeech(t))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[ \t]*(?:[-*]|\d+\.)[ \t]+/gm, "")
    .replace(/[`#>]/g, "")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}
