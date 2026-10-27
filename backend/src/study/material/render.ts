// Strukturierte Einträge in Markdown umsetzen (Formeln als $LaTeX$) und Dubletten entfernen
export interface RenderedItem {
  title: string;
  body: string;
  category: string | null;
  sourceRef: string | null;
  uncertain: boolean;
  data: Record<string, unknown>;
}

type Any = Record<string, any>;

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const math = (v: unknown) => {
  const t = s(v).replace(/^\$+|\$+$/g, "");
  return t ? `$${t}$` : "";
};
const list = (items: unknown, map: (x: any) => string, numbered = false) =>
  (Array.isArray(items) ? items : [])
    .map(map)
    .filter(Boolean)
    .map((x, i) => (numbered ? `${i + 1}. ${x}` : `- ${x}`))
    .join("\n");
const block = (label: string, text: string) => (text ? `**${label}:** ${text}` : "");
const join = (...parts: string[]) => parts.filter(Boolean).join("\n\n");

export function renderMerksatz(m: Any): RenderedItem {
  return {
    title: s(m.titel),
    body: join(s(m.merksatz), s(m.erklaerung) ? `*${s(m.erklaerung)}*` : "", block("Eselsbrücke", s(m.eselsbruecke))),
    category: s(m.kategorie) || "regel",
    sourceRef: s(m.verweis) || null,
    uncertain: !!m.unsicher,
    data: m,
  };
}

export function renderFormel(f: Any): RenderedItem {
  const symbols = list(f.symbole, (x: Any) => `${math(x.symbol)}: ${s(x.bedeutung)}${s(x.einheit) && s(x.einheit) !== "-" ? ` in ${s(x.einheit)}` : ""}`);
  return {
    title: s(f.name),
    body: join(`$$${s(f.formel).replace(/^\$+|\$+$/g, "")}$$`, symbols, block("Wann", s(f.anwendungsfall)), block("Achtung", s(f.stolperfalle)), f.umgestellt ? "*Umgestellt, steht so nicht im Heft.*" : ""),
    category: f.umgestellt ? "umgestellt" : null,
    sourceRef: s(f.verweis) || null,
    uncertain: !!f.unsicher,
    data: f,
  };
}

export function renderTeilaufgabe(a: Any, t: Any): RenderedItem {
  return {
    title: `Aufgabe ${s(a.nummer)}${s(t.nummer)}${s(a.titel) ? ` · ${s(a.titel)}` : ""}`,
    body: join(
      block("Typ erkennen", s(t.typ_erkennen)),
      list(t.gegeben, (x) => s(x)) ? `**Gegeben:**\n${list(t.gegeben, (x) => s(x))}` : "",
      block("Gesucht", s(t.gesucht)),
      list(t.formeln, (x) => math(x)) ? `**Formeln:**\n${list(t.formeln, (x) => math(x))}` : "",
      list(t.schritte, (x) => s(x), true) ? `**Lösungsweg:**\n${list(t.schritte, (x) => s(x), true)}` : "",
      list(t.checkliste, (x) => s(x)) ? `**Checkliste:**\n${list(t.checkliste, (x) => s(x))}` : "",
      block("Achtung", s(t.stolperfalle))
    ),
    category: t.punkte != null ? `${t.punkte} P` : null,
    sourceRef: s(t.verweis) || null,
    uncertain: !!t.unsicher,
    data: { aufgabe: { nummer: a.nummer, titel: a.titel, punkte: a.punkte }, ...t },
  };
}

export function renderRezept(r: Any): RenderedItem {
  const sizes = list(r.groessen, (x: Any) => `${math(x.symbol)}: ${s(x.bedeutung)}`);
  const formulas = list(r.formeln, (x: Any) => `${math(x.formel)}${s(x.erklaerung) ? ` (${s(x.erklaerung)})` : ""}`);
  return {
    title: `${s(r.code)} · ${s(r.titel)}`,
    body: join(
      s(r.worum_gehts),
      block("Erkennen", s(r.erkennen)),
      sizes ? `**Größen:**\n${sizes}` : "",
      formulas ? `**Formeln:**\n${formulas}` : "",
      list(r.vorgehen, (x) => s(x), true) ? `**Vorgehen:**\n${list(r.vorgehen, (x) => s(x), true)}` : "",
      block("Achtung", s(r.stolperfalle))
    ),
    category: s(r.kapitel) || null,
    sourceRef: null,
    uncertain: !!r.unsicher,
    data: r,
  };
}

// Überlappende Abschnitte liefern Einträge doppelt: Kern vergleichen
export function dedupe<T extends Any>(items: T[], key: (x: T) => unknown): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = s(key(it)).toLowerCase().replace(/\W+/g, "").slice(0, 80);
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
