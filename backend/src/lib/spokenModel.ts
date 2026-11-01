// Modellkennung als sprechbarer Name fürs Intro: „qwen3.6:27b“ → „Qwen 3.6“, „gemma4:e4b“ → „Gemma 4“.
// Größe und Variante hinter dem Doppelpunkt entfallen; die Ausspracheliste macht daraus „Kwenn“ und „Dschemma“
export function spokenModel(id: string | null | undefined): string {
  const base = (id ?? "").split(":")[0].trim();
  if (!base || base === "default") return "KI";
  const m = base.match(/^([a-z]+)[-_]?(\d+(?:\.\d+)?)?/i);
  if (!m) return base;
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  return m[2] ? `${name} ${m[2]}` : name;
}
