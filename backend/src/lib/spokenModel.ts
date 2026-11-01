// Modellkennung als sprechbarer Name fürs Intro: „qwen3.6:27b“ → „Qwen drei Punkt sechs“, „gemma4:e4b“ → „Gemma vier“.
// Größe und Variante hinter dem Doppelpunkt entfallen, Versionsziffern stehen als Zahlwort, damit die Stimme nicht
// über „3.6“ stolpert; die Ausspracheliste macht aus Qwen „Kwenn“ und aus Gemma „Dschemma“
const ONES = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
const TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];

// Zahlwort 0 bis 99; größere Zahlen Ziffer für Ziffer
export function numberWord(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return n % 10 ? `${n % 10 === 1 ? "ein" : ONES[n % 10]}und${TENS[Math.floor(n / 10)]}` : TENS[Math.floor(n / 10)];
  return String(n).split("").map((d) => ONES[Number(d)]).join(" ");
}

export function spokenModel(id: string | null | undefined): string {
  const base = (id ?? "").split(":")[0].trim();
  if (!base || base === "default") return "KI";
  const m = base.match(/^([a-z]+)[-_]?(\d+(?:\.\d+)*)?/i);
  if (!m) return base;
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  if (!m[2]) return name;
  const version = m[2].split(".").map((part) => numberWord(Number(part))).join(" Punkt ");
  return `${name} ${version}`;
}
