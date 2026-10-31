// Begriffsnetz: erfassen (Gemma im Hintergrund), Fortschritt, Begriffe eines Moduls mit Fundstellen und Grundlagen
import { Hono } from "hono";
import { db } from "../db";
import { cancelConceptRun, conceptRunState, enqueueConcepts, openChapters } from "../services/concepts/extract";

export const conceptRoutes = new Hono();

const moduleDocs = (moduleId: string) =>
  (db().prepare("SELECT id FROM documents WHERE module_id = ?").all(moduleId) as Array<{ id: string }>).map((r) => r.id);

conceptRoutes.get("/status", (c) => {
  const moduleId = c.req.query("moduleId");
  const docs = moduleId ? moduleDocs(moduleId) : undefined;
  return c.json({ ...conceptRunState(), open: docs && !docs.length ? 0 : openChapters(docs).length });
});

conceptRoutes.post("/extract", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { moduleId?: string; docIds?: string[]; model?: string };
  const docs = body.docIds?.length ? body.docIds : body.moduleId ? moduleDocs(body.moduleId) : [];
  if (!docs.length) return c.json({ error: "Keine Hefte" }, 400);
  return c.json(enqueueConcepts(docs, body.model || undefined));
});

conceptRoutes.post("/cancel", (c) => {
  cancelConceptRun();
  return c.json(conceptRunState());
});

// Begriffe, die in Heften des Moduls vorkommen, mit Fundstellen und Grundlagen (auch aus anderen Modulen)
conceptRoutes.get("/module/:id", (c) => {
  const d = db();
  const rows = d
    .prepare(
      `SELECT k.id, k.name, k.definition, m.role, m.chapter_id, ch.title AS chapter_title, ch.start_page, doc.id AS doc_id, doc.title AS doc_title
         FROM concept_mentions m
         JOIN concepts k ON k.id = m.concept_id
         JOIN chapters ch ON ch.id = m.chapter_id
         JOIN documents doc ON doc.id = m.document_id
        WHERE doc.module_id = ?
        ORDER BY k.name COLLATE NOCASE`
    )
    .all(c.req.param("id")) as Array<{ id: string; name: string; definition: string | null; role: string; chapter_id: string; chapter_title: string; start_page: number; doc_id: string; doc_title: string }>;
  const needs = d.prepare("SELECT DISTINCT n.id, n.name FROM concept_links l JOIN concepts n ON n.id = l.needs_id WHERE l.concept_id = ?");
  const neededBy = d.prepare("SELECT DISTINCT n.id, n.name FROM concept_links l JOIN concepts n ON n.id = l.concept_id WHERE l.needs_id = ?");
  const byId = new Map<string, { id: string; name: string; definition: string | null; places: Array<{ chapterId: string; chapter: string; page: number; docId: string; doc: string; explains: boolean }> }>();
  for (const r of rows) {
    const k = byId.get(r.id) ?? { id: r.id, name: r.name, definition: r.definition, places: [] };
    k.places.push({ chapterId: r.chapter_id, chapter: r.chapter_title, page: r.start_page, docId: r.doc_id, doc: r.doc_title, explains: r.role === "explains" });
    byId.set(r.id, k);
  }
  const concepts = [...byId.values()].map((k) => ({
    ...k,
    places: k.places.sort((a, b) => Number(b.explains) - Number(a.explains)),
    needs: needs.all(k.id) as Array<{ id: string; name: string }>,
    neededBy: neededBy.all(k.id) as Array<{ id: string; name: string }>,
  }));
  return c.json({ concepts });
});
