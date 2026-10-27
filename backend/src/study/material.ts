// Katalog-Einträge je Modul: Aufgaben, Rezepte, Merksätze, Formeln; Schlüssel ist die Grep-ID
import { db } from "../db";
import { StudyInputError } from "./assessments";

export const MATERIAL_KINDS = ["aufgabe", "rezept", "merksatz", "formel"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export interface MaterialItem {
  id: string;
  module_id: string | null;
  kind: MaterialKind;
  title: string;
  body_md: string;
  category: string | null;
  source_document_id: string | null;
  source_ref: string | null;
  uncertain: number;
  sort_order: number;
  data_json?: string | null;
  checked_at?: string | null;
}

// Grep-ID wie MOD-F-HEFT1-05: Großbuchstaben, Ziffern, Bindestriche
const GREP_ID_RE = /^[A-Z0-9][A-Z0-9_-]{2,80}$/;

export function upsertMaterial(item: Omit<MaterialItem, "uncertain" | "sort_order" | "category" | "source_document_id" | "source_ref"> & Partial<MaterialItem>): void {
  if (!GREP_ID_RE.test(item.id)) throw new StudyInputError(`Ungültige Grep-ID: ${item.id}`);
  if (!MATERIAL_KINDS.includes(item.kind)) throw new StudyInputError(`Unbekannte Art: ${item.kind}`);
  db()
    .prepare(
      `INSERT INTO material_items (id, module_id, kind, title, body_md, category, source_document_id, source_ref, uncertain, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, kind = excluded.kind, title = excluded.title,
         body_md = excluded.body_md, category = excluded.category, source_document_id = excluded.source_document_id,
         source_ref = excluded.source_ref, uncertain = excluded.uncertain, sort_order = excluded.sort_order,
         updated_at = datetime('now')`
    )
    .run(
      item.id,
      item.module_id ?? null,
      item.kind,
      item.title ?? "",
      item.body_md ?? "",
      item.category ?? null,
      item.source_document_id ?? null,
      item.source_ref ?? null,
      item.uncertain ?? (/\bunsicher\b/i.test(item.body_md ?? "") ? 1 : 0),
      item.sort_order ?? 0
    );
}

export function listMaterial(moduleId: string, kind?: MaterialKind): MaterialItem[] {
  const sql = "SELECT * FROM material_items WHERE module_id = ?" + (kind ? " AND kind = ?" : "") + " ORDER BY kind, sort_order, id";
  return (kind ? db().prepare(sql).all(moduleId, kind) : db().prepare(sql).all(moduleId)) as MaterialItem[];
}

export function materialCounts(moduleId: string): Record<MaterialKind | "uncertain", number> {
  const rows = db().prepare("SELECT kind, COUNT(*) AS n, SUM(uncertain) AS u FROM material_items WHERE module_id = ? GROUP BY kind").all(moduleId) as Array<{ kind: MaterialKind; n: number; u: number }>;
  const out = { aufgabe: 0, rezept: 0, merksatz: 0, formel: 0, uncertain: 0 };
  for (const r of rows) {
    out[r.kind] = r.n;
    out.uncertain += r.u ?? 0;
  }
  return out;
}

export function getMaterial(id: string): MaterialItem | null {
  return (db().prepare("SELECT * FROM material_items WHERE id = ?").get(id) as MaterialItem) ?? null;
}

// Prüfliste: unsichere Einträge über alle Module
export function uncertainItems(limit = 200): MaterialItem[] {
  return db().prepare("SELECT * FROM material_items WHERE uncertain = 1 ORDER BY module_id, id LIMIT ?").all(limit) as MaterialItem[];
}

// Abhaken merkt sich, wann geprüft wurde
export function setUncertain(id: string, uncertain: boolean): boolean {
  return db()
    .prepare("UPDATE material_items SET uncertain = ?, checked_at = CASE WHEN ? THEN NULL ELSE datetime('now') END, updated_at = datetime('now') WHERE id = ?")
    .run(uncertain ? 1 : 0, uncertain ? 1 : 0, id).changes > 0;
}
