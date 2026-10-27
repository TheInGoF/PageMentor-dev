// Zahlwort-Fehler kleiner LLMs reparieren oder melden

// Deutsches Zahlwort → Zahl, 0 bis 99
const GERMAN_NUMBER_WORDS: Record<string, number> = (() => {
  const map: Record<string, number> = {
    null: 0,
    ein: 1, eins: 1, eine: 1, einer: 1, einen: 1, einem: 1,
    zwei: 2, zwo: 2,
    drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9,
    zehn: 10, elf: 11, zwölf: 12,
    dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16,
    siebzehn: 17, achtzehn: 18, neunzehn: 19,
  };
  const tens: Array<[string, number]> = [
    ["zwanzig", 20], ["dreißig", 30], ["vierzig", 40], ["fünfzig", 50],
    ["sechzig", 60], ["siebzig", 70], ["achtzig", 80], ["neunzig", 90],
  ];
  const ones: Array<[string, number]> = [
    ["ein", 1], ["zwei", 2], ["drei", 3], ["vier", 4], ["fünf", 5],
    ["sechs", 6], ["sieben", 7], ["acht", 8], ["neun", 9],
  ];
  for (const [tWord, tNum] of tens) {
    map[tWord] = tNum;
    for (const [oWord, oNum] of ones) {
      map[`${oWord}und${tWord}`] = tNum + oNum;
    }
  }
  return map;
})();

function germanWordToInt(word: string): number | null {
  const v = GERMAN_NUMBER_WORDS[word.toLowerCase()];
  return v !== undefined ? v : null;
}

// Repariert:
// - "Beispiel zwei Punkt fünf" → "Beispiel 2.5"
// - "zweitausendachtzehn" → "2018"
// - "Seite 104 ff." → "Seite 104 und folgende"
// Meldet in `rejected`: unrettbare Wortbrei wie "zwehaufachtzig"
// Läuft pro Teilstück und einmal auf dem Gesamttext
export function fixGermanNumeralBleed(text: string): {
  text: string;
  rejected: string[];
} {
  const rejected: string[] = [];
  let result = text;

  // Abschnittsverweise, Punkt und Komma beide → "."
  const sectionRefRe =
    /\b(Beispiel|Beispiele|Abschnitt|Kapitel|Abbildung|Abbildungen|Tabelle|Tabellen|Formel|Formeln|Aufgabe|Aufgaben|Übung|Übungen|Frage|Fragen)\s+([A-Za-zäöüÄÖÜß]+)\s+(?:Punkt|Komma)\s+([A-Za-zäöüÄÖÜß]+)\b/g;
  result = result.replace(sectionRefRe, (match, kind: string, aWord: string, bWord: string) => {
    const a = germanWordToInt(aWord);
    const b = germanWordToInt(bWord);
    if (a !== null && b !== null) return `${kind} ${a}.${b}`;
    if (a !== null && b === null) rejected.push(match);
    return match;
  });

  // Ausgeschriebene Jahre → Ziffern
  const yearRe =
    /\b(neunzehnhundert|achtzehnhundert|zweitausend)([a-zäöüß]+)\b/gi;
  result = result.replace(yearRe, (match, prefix: string, rest: string) => {
    const lower = prefix.toLowerCase();
    const century =
      lower === "neunzehnhundert" ? 1900
      : lower === "achtzehnhundert" ? 1800
      : 2000;
    const offset = germanWordToInt(rest);
    if (offset !== null && offset >= 0 && offset <= 99) {
      return String(century + offset);
    }
    rejected.push(match);
    return match;
  });

  // f./ff.: Satzpunkt behalten, wenn Abkürzung am Satzende steht
  result = result.replace(
    /\b(Seite\s+\d+)\s*ff?\.(?=\s+[A-ZÄÖÜ]|\s*$)/g,
    "$1 und folgende.",
  );
  result = result.replace(
    /\b(Seite\s+\d+)\s*ff?\.\s*/g,
    "$1 und folgende ",
  );

  const garbledPatterns: RegExp[] = [
    // Falsche Stellenwert-Komposita: "zwehaufachtzig"
    /\b(?:zweh|dreh|vieh|fünh|siebh|neuh)auf[a-zäöüß]{2,}\b/gi,
    // Abgeschnittenes "folgende": "hundertvierf"
    /\b(?:hundert|tausend)[a-zäöüß]*vierf\b/gi,
    // Verklebte Jahre: "zweitausendelfteinundzwanzig"
    /\b(?:zweitausend|neunzehnhundert|achtzehnhundert)[a-zäöüß]{15,}\b/gi,
  ];
  for (const re of garbledPatterns) {
    for (const m of result.matchAll(re)) rejected.push(m[0]);
  }

  return { text: result, rejected: [...new Set(rejected)] };
}
