// Modulkarte lesen und pflegen, Ergebnis der Zuordnung am Dokument speichern
import { db } from "../../db";
import { StudyInputError } from "../assessments";
import { classify, headOf, type Classification, type ModuleKey } from "./classify";
import { checkQuality, type Quality } from "./quality";

export interface PrefixRow {
  prefix: string;
  module_id: string;
  confirmed: number;
  evidence: string | null;
}

const PREFIX_RE = /^[A-Za-z][A-Za-z0-9-]{1,15}$/;

export function moduleKeys(): ModuleKey[] {
  const mods = db().prepare("SELECT id, code FROM modules WHERE code IS NOT NULL").all() as Array<{ id: string; code: string }>;
  const prefixes = db().prepare("SELECT * FROM module_prefixes").all() as PrefixRow[];
  return mods.map((m) => ({
    code: m.code,
    prefixes: prefixes.filter((p) => p.module_id === m.id).map((p) => ({ prefix: p.prefix, confirmed: !!p.confirmed })),
  }));
}

// Präfixe, die auch andere Module nutzen
export function sharedPrefixes(moduleId: string): string[] {
  return (db()
    .prepare("SELECT DISTINCT a.prefix FROM module_prefixes a JOIN module_prefixes b ON a.prefix = b.prefix AND b.module_id != a.module_id WHERE a.module_id = ?")
    .all(moduleId) as Array<{ prefix: string }>).map((r) => r.prefix);
}

export function listPrefixes(moduleId?: string): PrefixRow[] {
  return (moduleId
    ? db().prepare("SELECT * FROM module_prefixes WHERE module_id = ? ORDER BY prefix").all(moduleId)
    : db().prepare("SELECT * FROM module_prefixes ORDER BY prefix").all()) as PrefixRow[];
}

// Ersetzt die Präfixe eines Moduls; gemeinsame Präfixe mehrerer Module führen nur zu Vorschlägen
export function setPrefixes(moduleId: string, items: Array<{ prefix: string; confirmed?: boolean; evidence?: string | null }>): PrefixRow[] {
  for (const it of items) if (!PREFIX_RE.test(it.prefix ?? "")) throw new StudyInputError(`Ungültiger Präfix: ${it.prefix}`);
  db().transaction(() => {
    db().prepare("DELETE FROM module_prefixes WHERE module_id = ?").run(moduleId);
    const ins = db().prepare("INSERT OR REPLACE INTO module_prefixes (prefix, module_id, confirmed, evidence) VALUES (?, ?, ?, ?)");
    for (const it of items) ins.run(it.prefix.toUpperCase(), moduleId, it.confirmed === false ? 0 : 1, it.evidence ?? null);
  })();
  return listPrefixes(moduleId);
}

export interface AssignResult {
  classification: Classification;
  quality: Quality;
  assigned: boolean;
}

// Nach der Umwandlung: Qualität prüfen, Modul nur bei Beleg setzen, sonst Vorschlag merken
export function assignAfterExtraction(docId: string, filename: string, markdown: string, pages: number): AssignResult {
  const quality = checkQuality(markdown, pages);
  const classification = classify(filename, headOf(markdown), moduleKeys());
  const doc = db().prepare("SELECT module_id, assign_confidence FROM documents WHERE id = ?").get(docId) as { module_id: string | null; assign_confidence: string | null } | null;
  const moduleId = classification.code
    ? ((db().prepare("SELECT id FROM modules WHERE code = ?").get(classification.code) as { id: string } | null)?.id ?? null)
    : null;
  // Wer beim Hochladen selbst ein Modul gewählt hat, behält es
  const manual = !!doc?.module_id;
  const assigned = !manual && classification.sure && !!moduleId;
  db()
    .prepare(
      `UPDATE documents SET assign_module_id = ?, assign_rule = ?, assign_confidence = ?, heft_code = ?, doc_date = ?,
         quality_json = ?, quality_flag = ?, module_id = CASE WHEN ? THEN ? ELSE module_id END WHERE id = ?`
    )
    .run(
      moduleId,
      classification.rule,
      manual ? "manuell" : assigned ? "hoch" : moduleId ? "niedrig" : null,
      classification.heftCode,
      classification.date,
      JSON.stringify(quality),
      quality.flag ? 1 : 0,
      assigned ? 1 : 0,
      moduleId,
      docId
    );
  return { classification, quality, assigned };
}

// Vorschlag übernehmen oder Modul von Hand setzen
export function confirmAssignment(docId: string, moduleId: string | null): boolean {
  return db().prepare("UPDATE documents SET module_id = ?, assign_confidence = 'manuell' WHERE id = ?").run(moduleId, docId).changes > 0;
}
