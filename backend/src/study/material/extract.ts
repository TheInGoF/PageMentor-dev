// Material aus einem Dokument extrahieren: Abschnitte → KI mit Schema → Einträge mit Grep-ID
// Antworten je Abschnitt im Cache: ein Abbruch kostet nichts, ein zweiter Lauf ist sofort fertig
import { createHash } from "crypto";
import { db } from "../../db";
import { emit } from "../../services/events";
import { withGemmaLock } from "../../services/gemmaLock";
import { generate } from "../../services/llm";
import { pickProvider } from "../../services/llm/providers";
import { runJob } from "../../log/jobs";
import { emitLog } from "../../log/logger";
import { PROMPTS, PROMPT_VERSION, type ExtractKind } from "./prompts";
import { SCHEMA_AUFGABEN, SCHEMA_FORMELN, SCHEMA_MERKSAETZE, SCHEMA_REZEPTE } from "./schemas";
import { dedupe, renderFormel, renderMerksatz, renderRezept, renderTeilaufgabe, type RenderedItem } from "./render";

export const CHUNK_CHARS = 20_000;
const CHUNK_OVERLAP = 800;
const LETTER: Record<ExtractKind, string> = { aufgabe: "A", rezept: "R", merksatz: "M", formel: "F" };
const SCHEMA: Record<ExtractKind, Record<string, unknown>> = { merksatz: SCHEMA_MERKSAETZE, formel: SCHEMA_FORMELN, aufgabe: SCHEMA_AUFGABEN, rezept: SCHEMA_REZEPTE };
// Verzeichnisse, Literatur und Vorwort liefern kein Material
const SKIP_CHAPTERS = new Set(["index", "references", "meta"]);

export type Ask = (kind: ExtractKind, text: string) => Promise<Record<string, any> | null>;

export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= size) return text.trim() ? [text] : [];
  const out: string[] = [];
  for (let start = 0; start < text.length; start += size - overlap) out.push(text.slice(start, start + size));
  return out;
}

// Auch Antworten mit Vorspann oder Codeblock retten
export function parseJson(raw: string): Record<string, any> | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(cleaned.slice(a, b + 1));
  } catch {
    return null;
  }
}

// Kurzer, stabiler Quellcode für die Grep-ID, z. B. Heftcode oder Kürzel des Dokuments
export function sourceCode(doc: { heft_code?: string | null; short_code?: string | null; title: string }): string {
  const raw = doc.heft_code || doc.short_code || doc.title;
  const ascii = raw.replace(/ä/gi, "AE").replace(/ö/gi, "OE").replace(/ü/gi, "UE").replace(/ß/g, "SS");
  return ascii.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").toUpperCase().slice(0, 16).replace(/^-+|-+$/g, "") || "DOK";
}

// Ergebnisse aller Abschnitte zusammenführen und nummerieren
export function buildItems(kind: ExtractKind, results: Array<Record<string, any>>, prefix: string): Array<RenderedItem & { id: string }> {
  let items: RenderedItem[] = [];
  if (kind === "merksatz") items = dedupe(results.flatMap((r) => r.merksaetze ?? []), (m) => m.merksatz).map(renderMerksatz);
  if (kind === "formel") items = dedupe(results.flatMap((r) => r.formeln ?? []), (f) => f.formel).map(renderFormel);
  if (kind === "aufgabe") {
    const aufgaben = dedupe(results.flatMap((r) => r.aufgaben ?? []), (a) => `${a.nummer}${a.titel}`);
    items = aufgaben.flatMap((a) => (a.teilaufgaben ?? []).map((t: any) => renderTeilaufgabe(a, t)));
  }
  if (kind === "rezept") {
    const types = dedupe(results.flatMap((r) => r.aufgabentypen ?? []), (t) => t.code || t.titel);
    return types.map((t) => ({ ...renderRezept(t), id: `${prefix}-${String(t.code || "X").toUpperCase().replace(/[^A-Z0-9]/g, "")}` }));
  }
  return items.map((it, i) => ({ ...it, id: `${prefix}-${String(i + 1).padStart(2, "0")}` }));
}

async function modelKey(): Promise<string> {
  const p = await pickProvider();
  return p ? `${p.type}:${p.model}` : "none";
}

// Standard: lokale KI über die Engine, mit Cache und zweitem Versuch
export const askModel: Ask = async (kind, text) => {
  const key = createHash("sha1").update(`${kind}|${PROMPT_VERSION}|${await modelKey()}|${text}`).digest("hex");
  const hit = db().prepare("SELECT result_json FROM llm_cache WHERE key = ?").get(key) as { result_json: string } | null;
  if (hit) return JSON.parse(hit.result_json);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await withGemmaLock(`material:${kind}`, () =>
      generate({ system: PROMPTS[kind], prompt: `=== TEXT ===\n${text}`, format: SCHEMA[kind], options: { temperature: 0.2, num_ctx: 32768 } })
    );
    const data = parseJson(res.response);
    if (data) {
      db().prepare("INSERT OR REPLACE INTO llm_cache (key, kind, result_json) VALUES (?, ?, ?)").run(key, kind, JSON.stringify(data));
      return data;
    }
    emitLog("warn", "material", `Kein gültiges JSON (${kind}, Versuch ${attempt})`);
  }
  return null;
};

interface DocRow {
  id: string;
  title: string;
  type: string;
  module_id: string | null;
  heft_code: string | null;
  short_code: string | null;
  code: string | null;
}

function documentText(docId: string): string {
  const chapters = db().prepare("SELECT title, text, kind FROM chapters WHERE document_id = ? ORDER BY number").all(docId) as Array<{ title: string; text: string; kind: string | null }>;
  return chapters
    .filter((c) => !SKIP_CHAPTERS.has(c.kind ?? ""))
    .map((c) => `## ${c.title}\n\n${c.text.replace(/!\[[^\]]*\]\([^)]*\)/g, "")}`)
    .join("\n\n");
}

function store(kind: ExtractKind, items: Array<RenderedItem & { id: string }>, moduleId: string, docId: string | null): void {
  db().transaction(() => {
    // Nur eigene, früher erzeugte Einträge ersetzen; Importe aus dem Studium Maker bleiben
    if (docId) db().prepare("DELETE FROM material_items WHERE source_document_id = ? AND kind = ?").run(docId, kind);
    else db().prepare("DELETE FROM material_items WHERE module_id = ? AND kind = ? AND source_document_id IS NULL AND source_file IS NULL").run(moduleId, kind);
    const ins = db().prepare(
      `INSERT OR REPLACE INTO material_items (id, module_id, kind, title, body_md, category, source_document_id, source_ref, uncertain, sort_order, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    items.forEach((it, i) => ins.run(it.id, moduleId, kind, it.title, it.body, it.category, docId, it.sourceRef, it.uncertain ? 1 : 0, i, JSON.stringify(it.data)));
  })();
}

export interface ExtractResult {
  kind: ExtractKind;
  items: number;
  uncertain: number;
  chunks: number;
  failedChunks: number;
}

// Merksätze und Formeln aus Heften, Aufgaben aus Klausuren und Übungen
export function defaultKinds(docType: string): ExtractKind[] {
  return docType === "klausur" || docType === "uebung" ? ["aufgabe"] : ["merksatz", "formel"];
}

// Vorab prüfen, damit die Oberfläche sofort eine klare Meldung bekommt
export function extractProblem(docId: string): string | null {
  const doc = db().prepare("SELECT d.module_id, m.code, (SELECT COUNT(*) FROM chapters c WHERE c.document_id = d.id) AS n FROM documents d LEFT JOIN modules m ON m.id = d.module_id WHERE d.id = ?").get(docId) as { module_id: string | null; code: string | null; n: number } | null;
  if (!doc) return "Dokument nicht gefunden";
  if (!doc.module_id || !doc.code) return "Dokument braucht ein Modul mit Kürzel";
  if (!doc.n) return "Dokument hat noch keinen Text";
  return null;
}

export async function extractFromDocument(docId: string, kinds?: ExtractKind[], ask: Ask = askModel): Promise<ExtractResult[]> {
  const doc = db()
    .prepare("SELECT d.id, d.title, d.type, d.module_id, d.heft_code, d.short_code, m.code FROM documents d LEFT JOIN modules m ON m.id = d.module_id WHERE d.id = ?")
    .get(docId) as DocRow | null;
  if (!doc) throw new Error("Dokument nicht gefunden");
  if (!doc.module_id || !doc.code) throw new Error("Dokument braucht ein Modul mit Kürzel");
  const chunks = chunkText(documentText(docId));
  if (!chunks.length) throw new Error("Dokument hat noch keinen Text");
  const todo = kinds?.length ? kinds.filter((k) => k !== "rezept") : defaultKinds(doc.type);

  return runJob("material", "material", { docId }, async () => {
    emit({ phase: "material.start", docId, total: chunks.length * todo.length });
    const out: ExtractResult[] = [];
    let step = 0;
    try {
      for (const kind of todo) {
        const results: Array<Record<string, any>> = [];
        let failed = 0;
        for (const chunk of chunks) {
          const r = await ask(kind, chunk);
          if (r) results.push(r);
          else failed++;
          emit({ phase: "material.progress", docId, current: ++step, total: chunks.length * todo.length, message: kind });
        }
        const items = buildItems(kind, results, `${doc.code}-${LETTER[kind]}-${sourceCode(doc)}`);
        store(kind, items, doc.module_id!, docId);
        out.push({ kind, items: items.length, uncertain: items.filter((i) => i.uncertain).length, chunks: chunks.length, failedChunks: failed });
        emitLog("info", "material", `${doc.title}: ${items.length} ${kind} (${failed} Abschnitte ohne Ergebnis)`, { ctx: { docId } });
      }
      emit({ phase: "material.done", docId, message: out.map((r) => `${r.items} ${r.kind}`).join(", ") });
      return out;
    } catch (err) {
      emit({ phase: "material.failed", docId, message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  });
}

// Rezepte: wiederkehrende Aufgabentypen aus allen Aufgaben eines Moduls
export async function synthesizeRecipes(moduleId: string, ask: Ask = askModel): Promise<ExtractResult> {
  const mod = db().prepare("SELECT code FROM modules WHERE id = ?").get(moduleId) as { code: string | null } | null;
  if (!mod?.code) throw new Error("Modul braucht ein Kürzel");
  const tasks = db().prepare("SELECT title, body_md FROM material_items WHERE module_id = ? AND kind = 'aufgabe' ORDER BY id").all(moduleId) as Array<{ title: string; body_md: string }>;
  if (!tasks.length) throw new Error("Noch keine Aufgaben im Modul");
  const chunks = chunkText(tasks.map((t) => `### ${t.title}\n${t.body_md}`).join("\n\n"), CHUNK_CHARS, 0);
  return runJob("rezepte", "material", { moduleId }, async () => {
    const results: Array<Record<string, any>> = [];
    let failed = 0;
    for (const chunk of chunks) {
      const r = await ask("rezept", chunk);
      if (r) results.push(r);
      else failed++;
    }
    const items = buildItems("rezept", results, `${mod.code}-R`);
    store("rezept", items, moduleId, null);
    return { kind: "rezept" as const, items: items.length, uncertain: items.filter((i) => i.uncertain).length, chunks: chunks.length, failedChunks: failed };
  });
}
