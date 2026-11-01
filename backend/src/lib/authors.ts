// Mehrere Autoren in einem Feld: „A; B“, „A, B“, „A und B“, „A & B“, „A / B“. Für Audiobookshelf als Liste,
// zum Vorlesen mit „und“ verbunden („A, B und C“). „Nachname, Vorname“ (ein Wort je Seite) bleibt eine Person
export function splitAuthors(raw: string | null | undefined): string[] {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  const parts = s
    .split(/\s*;\s*|\s+(?:und|and|&|\/)\s+|\s*\/\s*/i)
    .flatMap((p) => {
      const byComma = p.split(/\s*,\s*/).filter(Boolean);
      // Komma trennt nur volle Namen; „Babiloni, Ana“ ist eine Person
      return byComma.length > 1 && byComma.every((x) => x.split(" ").length >= 2) ? byComma : [p];
    })
    .map((p) => p.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

// Zum Sprechen und für Anzeigen: „A“, „A und B“, „A, B und C“
export function joinAuthors(list: string[], lang: string = "de"): string {
  const and = lang.startsWith("de") ? "und" : lang.startsWith("es") ? "y" : "and";
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} ${and} ${list[list.length - 1]}`;
}

export function spokenAuthors(raw: string | null | undefined, lang: string = "de"): string {
  return joinAuthors(splitAuthors(raw), lang);
}
