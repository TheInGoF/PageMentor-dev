// Gehirn-Export: das Begriffsnetz als Markdown, je Kapitel die Begriffe mit Rolle, Erklärung und „baut auf“,
// optional mit einem Textauszug als Beleg. Zum Prüfen durch ein großes Modell, ohne Auftrag und ohne Prompt
import { db } from "../../db";

export interface BrainExportOptions {
  moduleId?: string;
  // Zeichen Kapiteltext als Beleg; 0 = ohne
  excerpt?: number;
}

const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function excerptOf(text: string, n: number): string {
  const t = oneLine(text);
  return t.length > n ? `${t.slice(0, n).replace(/\s\S*$/, "")} …` : t;
}

export function brainExport(opts: BrainExportOptions = {}): { markdown: string; chapters: number; concepts: number } {
  const d = db();
  const excerpt = Math.max(0, Math.min(6000, opts.excerpt ?? 800));
  const modFilter = opts.moduleId ? "AND doc.module_id = ?" : "";
  const modArgs = opts.moduleId ? [opts.moduleId] : [];
  const moduleName = opts.moduleId ? (d.prepare("SELECT name FROM modules WHERE id = ?").get(opts.moduleId) as { name: string } | undefined)?.name : null;

  // Kapitel mit Begriffen, in Lesereihenfolge
  const chapters = d
    .prepare(
      `SELECT DISTINCT ch.id, ch.title, ch.start_page, ch.text, ch.sort_order, ch.number, doc.id AS doc_id, doc.title AS doc_title, m.name AS module
         FROM concept_mentions cm
         JOIN chapters ch ON ch.id = cm.chapter_id
         JOIN documents doc ON doc.id = cm.document_id
         LEFT JOIN modules m ON m.id = doc.module_id
        WHERE 1 = 1 ${modFilter}
        ORDER BY m.name COLLATE NOCASE, doc.title COLLATE NOCASE, ch.sort_order, ch.number`
    )
    .all(...modArgs) as Array<{ id: string; title: string; start_page: number | null; text: string; doc_id: string; doc_title: string; module: string | null }>;

  const mentionsOf = d.prepare(
    `SELECT k.id, k.name, cm.role, COALESCE(cm.definition, k.definition) AS def FROM concept_mentions cm JOIN concepts k ON k.id = cm.concept_id
      WHERE cm.chapter_id = ? ORDER BY cm.role = 'explains' DESC, k.name COLLATE NOCASE`
  );
  const linksOf = d.prepare(
    "SELECT l.concept_id AS a, n.name AS b FROM concept_links l JOIN concepts n ON n.id = l.needs_id WHERE l.chapter_id = ? ORDER BY n.name COLLATE NOCASE"
  );

  // Begriffe und Verbindungen im Umfang
  const scopeConcepts = `SELECT DISTINCT cm.concept_id FROM concept_mentions cm JOIN documents doc ON doc.id = cm.document_id WHERE 1 = 1 ${modFilter}`;
  const concepts = d
    .prepare(`SELECT k.id, k.name, k.definition, (SELECT COUNT(*) FROM concept_mentions x WHERE x.concept_id = k.id) AS n FROM concepts k WHERE k.id IN (${scopeConcepts})`)
    .all(...modArgs) as Array<{ id: string; name: string; definition: string | null; n: number }>;
  const ids = new Set(concepts.map((c) => c.id));
  const links = (d.prepare("SELECT concept_id AS a, needs_id AS b, COUNT(*) AS w FROM concept_links GROUP BY concept_id, needs_id").all() as Array<{ a: string; b: string; w: number }>).filter(
    (l) => ids.has(l.a) && ids.has(l.b) && l.a !== l.b
  );

  const out: string[] = [];
  const date = new Date().toISOString().slice(0, 10);
  out.push(`# PageMentor – Begriffsnetz (${date})`, "");
  out.push(`Umfang: ${moduleName ? `Modul „${moduleName}“` : "alle Module"} · ${chapters.length} Kapitel · ${concepts.length} Begriffe · ${links.length} Verbindungen „baut auf“`, "");
  out.push("## Kapitel", "");
  let lastDoc = "";
  for (const ch of chapters) {
    if (ch.doc_id !== lastDoc) {
      out.push(`### ${ch.module ? `${ch.module} › ` : ""}${ch.doc_title}`, "");
      lastDoc = ch.doc_id;
    }
    out.push(`#### ${oneLine(ch.title) || "(ohne Titel)"}${ch.start_page ? ` (S. ${ch.start_page})` : ""}`, "");
    if (excerpt > 0 && ch.text) out.push(`> ${excerptOf(ch.text, excerpt)}`, "");
    const needs = new Map<string, string[]>();
    for (const l of linksOf.all(ch.id) as Array<{ a: string; b: string }>) needs.set(l.a, [...(needs.get(l.a) ?? []), l.b]);
    for (const m of mentionsOf.all(ch.id) as Array<{ id: string; name: string; role: string; def: string | null }>) {
      const n = needs.get(m.id);
      out.push(`- **${m.name}** (${m.role === "explains" ? "erklärt" : "nutzt"}): ${oneLine(m.def) || "–"}${n?.length ? ` — baut auf: ${n.join(", ")}` : ""}`);
    }
    out.push("");
  }
  return { markdown: out.join("\n"), chapters: chapters.length, concepts: concepts.length };
}
