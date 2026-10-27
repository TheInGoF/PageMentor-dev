// Modulzuordnung nur mit Beleg: Kürzel oder Heft-Präfix auf dem Dokument, nie thematisch
// Regeln aus dem Studium Maker (04_classify_rules), Dateiname zählt stärker als der Kopf

export interface ModuleKey {
  code: string;
  prefixes: Array<{ prefix: string; confirmed: boolean }>;
}

export type DocKind = "studienheft" | "klausur" | "uebung" | "script" | null;

export interface Classification {
  code: string | null;
  rule: string;
  // sicher = automatisch zuordnen; sonst nur Vorschlag unter „Ohne Modul“
  sure: boolean;
  kind: DocKind;
  heftCode: string | null;
  date: string | null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (s: string, flags = "i") => new RegExp(`(?<![A-Za-z0-9])${esc(s)}(?![A-Za-z0-9])`, flags);
const starts = (s: string) => new RegExp(`(?<![A-Za-z0-9])${esc(s)}`, "i");

// Verwaltung und Code: nie Lernmaterial eines Moduls
const SPECIAL = /notenbescheid|notenauszug|noten[-_ ]bisher|campus[-_ ]auszug|studienplaner|uebergabe|readme|liesmich/i;

const KIND_RULES: Array<[Exclude<DocKind, null>, RegExp]> = [
  ["klausur", /klausur|pr[uü]fungsaufgabe|pr[uü]fungsleistung|bearbeitungszeit|erreichbare punkte|hilfsmittel|punkteverteilung|\bL?UEKL\b/i],
  ["uebung", /einsendeaufgabe|aufgabenblatt|übungsblatt|uebungsblatt|\bESA\b/i],
  ["studienheft", /studienheft|lehrheft|lernziele/i],
];

const MONTHS: Record<string, string> = {
  januar: "01", februar: "02", maerz: "03", märz: "03", april: "04", mai: "05", juni: "06",
  juli: "07", august: "08", september: "09", oktober: "10", november: "11", dezember: "12",
};

export function findDate(name: string, head: string): string | null {
  let m = /\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/.exec(name);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}`;
  // Klausurcode wie ABC01_1119K08 → 2019-11
  m = /_(\d{2})(\d{2})[KA]\d/.exec(name);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `20${m[2]}-${m[1]}`;
  for (const [mon, num] of Object.entries(MONTHS)) {
    m = new RegExp(`${mon}\\s+(20\\d{2})`, "i").exec(`${name} ${head}`);
    if (m) return `${m[1]}-${num}`;
  }
  m = /(?<!\d)(20\d{2})(?!\d)/.exec(name) ?? /(?<!\d)(20\d{2})(?!\d)/.exec(head);
  return m ? m[1] : null;
}

export function findModule(name: string, head: string, modules: ModuleKey[]): { code: string | null; rule: string; sure: boolean } {
  // 1. Kürzel im Dateinamen
  for (const m of modules) if (word(m.code).test(name)) return { code: m.code, rule: `kuerzel:${m.code}@name`, sure: true };

  // 2. Heft-Präfix im Dateinamen, längster gewinnt, mehrdeutig = Vorschlag
  const hits: Array<{ len: number; code: string; prefix: string; confirmed: boolean }> = [];
  for (const m of modules) for (const p of m.prefixes) if (starts(p.prefix).test(name)) hits.push({ len: p.prefix.length, code: m.code, ...p });
  if (hits.length) {
    hits.sort((a, b) => b.len - a.len);
    const best = hits[0];
    const codes = new Set(hits.map((h) => h.code));
    if (codes.size > 1) return { code: best.code, rule: `praefix:${best.prefix}@name(mehrdeutig:${codes.size})`, sure: false };
    return { code: best.code, rule: `praefix:${best.prefix}@name${best.confirmed ? "" : "(unbelegt)"}`, sure: best.confirmed };
  }

  // 3. Kürzel im Dokumentkopf
  for (const m of modules) if (word(m.code).test(head)) return { code: m.code, rule: `kuerzel:${m.code}@kopf`, sure: true };

  // 4. Heft-Präfix mit Ziffer im Kopf: schwächer, nie sicher
  for (const m of modules)
    for (const p of m.prefixes)
      if (p.prefix.length >= 3 && new RegExp(`(?<![A-Za-z0-9])${esc(p.prefix)}\\d`, "i").test(head))
        return { code: m.code, rule: `praefix:${p.prefix}@kopf`, sure: false };

  return { code: null, rule: "kein_treffer", sure: false };
}

export function classify(name: string, head: string, modules: ModuleKey[]): Classification {
  const date = findDate(name, head);
  if (SPECIAL.test(name)) return { code: null, rule: "sondertyp:verwaltung", sure: false, kind: null, heftCode: null, date };

  const found = findModule(name, head, modules);
  const hay = `${name}\n${head}`;
  const kind = KIND_RULES.find(([, re]) => re.test(hay))?.[0] ?? null;

  // Heftcode auf der Titelseite ist ein harter Beleg; unbekanntes Heft nie automatisch
  const heft = /Studienheft\s+([A-Z]{2,6}\d{2})/.exec(head) ?? /\b([A-Z]{2,6}\d{2})_\d{4}[KA]\d{2}\b/.exec(name);
  const heftCode = heft ? heft[1] : null;
  let sure = found.sure;
  if (heftCode) {
    const known = modules.some((m) => m.prefixes.some((p) => p.prefix.toUpperCase() === heftCode.slice(0, -2).toUpperCase()));
    if (!known) sure = false;
  }
  return { ...found, sure, kind, heftCode, date };
}

// Erste Zeilen des Markdowns, wie im Studium Maker
export function headOf(markdown: string, lines = 40): string {
  return markdown.split("\n", lines).join("\n");
}
