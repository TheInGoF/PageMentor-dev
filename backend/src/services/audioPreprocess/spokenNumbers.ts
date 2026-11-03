// Zahlen, an denen die Stimmen scheitern, vor der Sprachausgabe in Worte fassen:
// Kommazahlen ("0,318" → "null Komma drei eins acht") und große Zahlen ab 10 000
// ("1.250.000" → "eine Million zweihundertfünfzigtausend"). Kleinere Zahlen und Jahre bleiben Ziffern,
// die sprechen alle Stimmen richtig. Fest im Code statt im Prompt: gilt für jeden Text, egal welches Modell ihn schrieb.

const ONES = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"];
const TEENS = ["zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
const TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];

// 1 bis 999; "final": am Ende der ganzen Zahl heißt 1 "eins", davor "ein" (einhundert, einundzwanzigtausend)
function under1000(n: number, final: boolean): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let out = h ? `${h === 1 ? "ein" : ONES[h]}hundert` : "";
  if (r === 0) return out;
  if (r === 1) return out + (final ? "eins" : "ein");
  if (r < 10) return out + ONES[r];
  if (r < 20) return out + TEENS[r - 10];
  const o = r % 10;
  return out + (o ? `${o === 1 ? "ein" : ONES[o]}und` : "") + TENS[Math.floor(r / 10)];
}

// Ganze Zahl in Worten; Gruppen mit Leerzeichen getrennt, damit keine Wortungetüme entstehen
export function intToGerman(n: number): string {
  if (n === 0) return "null";
  const parts: string[] = [];
  const big: Array<[number, string, string]> = [
    [1e9, "Milliarde", "Milliarden"],
    [1e6, "Million", "Millionen"],
  ];
  let rest = n;
  for (const [unit, one, many] of big) {
    const q = Math.floor(rest / unit);
    if (q) parts.push(q === 1 ? `eine ${one}` : `${under1000(q, true)} ${many}`);
    rest %= unit;
  }
  const t = Math.floor(rest / 1000);
  if (t) parts.push(`${under1000(t, false)}tausend`);
  rest %= 1000;
  if (rest) parts.push(under1000(rest, true));
  return parts.join(" ");
}

// Nachkommastellen Ziffer für Ziffer, wie man sie vorliest
const digits = (s: string) => [...s].map((d) => ONES[+d]).join(" ");

// Mehr als zwölf Stellen (Telefon, ISBN): Ziffer für Ziffer
function wholeToGerman(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length > 12 ? digits(d) : intToGerman(Number(d));
}

// Tausendergruppen mit Punkt, schmalem oder festem Leerzeichen oder Leerzeichen: 1.000.000, 250 000
const GROUPED = String.raw`\d{1,3}(?:[.   ]\d{3})+`;

export function verbalizeNumbers(text: string): string {
  return text
    // Kommazahlen, auch mit Tausenderpunkten ("1.234,5"); Aufzählungen wie "1,2,3" bleiben
    .replace(new RegExp(String.raw`(?<![\d.,])(${GROUPED}|\d+),(\d+)(?![\d]|[.,]\d)`, "g"), (_, whole: string, frac: string) =>
      `${wholeToGerman(whole)} Komma ${digits(frac)}`)
    // Große Zahlen mit Tausendertrennern
    .replace(new RegExp(String.raw`(?<![\d.,])${GROUPED}(?![\d]|[.,]\d)`, "g"), (m) => {
      const n = Number(m.replace(/\D/g, ""));
      return n >= 10000 ? wholeToGerman(m) : m;
    })
    // Große Zahlen ohne Trenner ab fünf Stellen
    .replace(/(?<![\d.,])\d{5,}(?![\d]|[.,]\d)/g, (m) => wholeToGerman(m));
}
