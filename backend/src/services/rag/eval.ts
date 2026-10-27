// Prüffragen mit bekannter Fundstelle: misst, ob die Suche das richtige Heft (und die Seite) findet
import { randomUUID } from "crypto";
import { db } from "../../db";
import { hybridSearch } from "./hybrid";

export interface EvalQuestion {
  id: string;
  question: string;
  module_id: string | null;
  expected_document_id: string;
  expected_page: number | null;
}

export function listEval(): Array<EvalQuestion & { doc_title: string }> {
  return db().prepare("SELECT e.*, d.title AS doc_title FROM rag_eval e JOIN documents d ON d.id = e.expected_document_id ORDER BY e.created_at").all() as Array<EvalQuestion & { doc_title: string }>;
}

export function addEval(q: Omit<EvalQuestion, "id">): EvalQuestion {
  if (!q.question?.trim()) throw new Error("Frage fehlt");
  const row = { ...q, id: randomUUID(), question: q.question.trim() };
  db().prepare("INSERT INTO rag_eval (id, question, module_id, expected_document_id, expected_page) VALUES (?, ?, ?, ?, ?)").run(row.id, row.question, row.module_id ?? null, row.expected_document_id, row.expected_page ?? null);
  return row;
}

export function deleteEval(id: string): boolean {
  return db().prepare("DELETE FROM rag_eval WHERE id = ?").run(id).changes > 0;
}

// Treffer: Abschnitt aus dem erwarteten Heft; mit Seite muss sie im Abschnitt liegen (±1)
export function isHit(row: { document_id: string; start_page: number; end_page: number }, q: Pick<EvalQuestion, "expected_document_id" | "expected_page">): boolean {
  if (row.document_id !== q.expected_document_id) return false;
  if (q.expected_page == null) return true;
  return q.expected_page >= row.start_page - 1 && q.expected_page <= row.end_page + 1;
}

export interface EvalReport {
  k: number;
  questions: number;
  recall: number;
  mrr: number;
  mode: string;
  results: Array<{ id: string; question: string; rank: number | null }>;
}

export async function runEval(k = 12, search = hybridSearch): Promise<EvalReport> {
  const qs = listEval();
  const results: EvalReport["results"] = [];
  let mode = "text";
  for (const q of qs) {
    const r = await search(q.question, q.module_id, k);
    mode = r.mode;
    const rows = r.rowids.length
      ? (db().prepare(`SELECT rowid AS rid, document_id, start_page, end_page FROM chunks WHERE rowid IN (${r.rowids.map(() => "?").join(",")})`).all(...r.rowids) as Array<{ rid: number; document_id: string; start_page: number; end_page: number }>)
      : [];
    const byRid = new Map(rows.map((x) => [x.rid, x]));
    const idx = r.rowids.findIndex((rid) => byRid.has(rid) && isHit(byRid.get(rid)!, q));
    results.push({ id: q.id, question: q.question, rank: idx >= 0 ? idx + 1 : null });
  }
  const hits = results.filter((x) => x.rank);
  return {
    k,
    questions: qs.length,
    recall: qs.length ? Math.round((hits.length / qs.length) * 100) / 100 : 0,
    mrr: qs.length ? Math.round((hits.reduce((s, x) => s + 1 / x.rank!, 0) / qs.length) * 100) / 100 : 0,
    mode,
    results,
  };
}
