// Katalog-Markdown in Einträge zerlegen; Trenner ist eine Zeile, die mit einer Grep-ID beginnt
import type { MaterialKind } from "../material";

export interface ParsedItem {
  id: string;
  title: string;
  body: string;
  category: string | null;
}

// Grep-ID: KÜRZEL-ART-REST, z. B. MOD1-F-HEFT1-05 oder MOD1-A-UEKL-1-2022-2b
const ID_RE = /([A-Z][A-Z0-9]{1,15}-[ARMFT]-[A-Za-z0-9][A-Za-z0-9_-]*)/;
const HEAD_RE = /^(#{1,6}\s+|\*\*|- \*\*)?\s*`?\[?([A-Z][A-Z0-9]{1,15}-[ARMFT]-[A-Za-z0-9][A-Za-z0-9_-]*)/;

export const KIND_LETTER: Record<MaterialKind, string> = { aufgabe: "A", rezept: "R", merksatz: "M", formel: "F" };

function cleanTitle(line: string, id: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(id, "")
    .replace(/[*`[\]]/g, "")
    .replace(/^[\s:·—–-]+|[\s:·—–-]+$/g, "")
    .trim();
}

export function splitCatalog(md: string, code: string, kind: MaterialKind): ParsedItem[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const items: ParsedItem[] = [];
  let current: ParsedItem | null = null;
  let category: string | null = null;
  for (const line of lines) {
    const head = HEAD_RE.exec(line);
    if (head) {
      if (current) items.push(current);
      current = { id: head[2].toUpperCase(), title: cleanTitle(line, head[2]), body: "", category };
      continue;
    }
    // Zwischenüberschrift ohne ID = Kategorie für die folgenden Einträge
    const section = /^#{1,3}\s+(.+)$/.exec(line);
    if (section && !ID_RE.test(line)) {
      if (current) items.push(current);
      current = null;
      category = section[1].trim();
      continue;
    }
    if (current) current.body += line + "\n";
  }
  if (current) items.push(current);
  for (const it of items) it.body = it.body.trim();

  // Ohne IDs: ganzer Katalog als ein Eintrag, nichts geht verloren
  if (!items.length && md.trim()) {
    return [{ id: `${code}-${KIND_LETTER[kind]}-KATALOG`, title: lines.find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "") ?? "Katalog", body: md.trim(), category: null }];
  }
  // Doppelte IDs: spätere bekommen einen Zähler, statt zu überschreiben
  const seen = new Map<string, number>();
  for (const it of items) {
    const n = (seen.get(it.id) ?? 0) + 1;
    seen.set(it.id, n);
    if (n > 1) it.id = `${it.id}-${n}`;
  }
  return items;
}
