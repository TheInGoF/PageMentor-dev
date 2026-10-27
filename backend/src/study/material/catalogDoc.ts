// Lernkatalog je Modul als eigenes Dokument: Kapitel zum Vorlesen, Karten zum Wiederholen
// So nutzen Hörbuch und Karten ihre vorhandene Pipeline, auch für Einträge ohne Quelldokument
import { db } from "../../db";
import { markdownToSpeech } from "./speech";

const KINDS = [
  { kind: "merksatz", title: "Merksätze", question: (t: string) => `Merksatz: ${t}` },
  { kind: "formel", title: "Formeln", question: (t: string) => `Formel: ${t}` },
] as const;

interface Item {
  id: string;
  kind: string;
  title: string;
  body_md: string;
  uncertain: number;
}

export function ensureCatalogDocument(moduleId: string): string {
  const mod = db().prepare("SELECT name, code FROM modules WHERE id = ?").get(moduleId) as { name: string; code: string | null } | null;
  if (!mod) throw new Error("Modul nicht gefunden");
  const id = `katalog-${moduleId}`;
  db()
    .prepare(
      `INSERT INTO documents (id, title, filename, stored_path, mime_type, type, module_id, ocr_status, language)
       VALUES (?, ?, 'lernkatalog.md', '', 'text/markdown', 'sonstiges', ?, 'done', 'de')
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, module_id = excluded.module_id`
    )
    .run(id, `Lernkatalog ${mod.code ?? mod.name}`, moduleId);
  return id;
}

// Nur sichere Einträge: was noch „unsicher“ ist, soll man sich nicht einprägen
function items(moduleId: string, kind: string): Item[] {
  return db().prepare("SELECT id, kind, title, body_md, uncertain FROM material_items WHERE module_id = ? AND kind = ? AND uncertain = 0 ORDER BY sort_order, id").all(moduleId, kind) as Item[];
}

export interface CatalogResult {
  documentId: string;
  chapters: number;
  cards: number;
  skippedUncertain: number;
}

export function buildCatalog(moduleId: string, opts: { audio: boolean; cards: boolean }): CatalogResult {
  const documentId = ensureCatalogDocument(moduleId);
  let chapters = 0;
  let cards = 0;
  const skippedUncertain = (db().prepare("SELECT COUNT(*) AS n FROM material_items WHERE module_id = ? AND kind IN ('merksatz','formel') AND uncertain = 1").get(moduleId) as { n: number }).n;

  db().transaction(() => {
    KINDS.forEach((k, i) => {
      const list = items(moduleId, k.kind);
      const chapterId = `${documentId}-${k.kind}`;
      if (opts.audio && list.length) {
        const text = list.map((it) => `### ${it.title}\n\n${it.body_md}`).join("\n\n");
        const spoken = list.map((it) => `${it.title}.\n\n${markdownToSpeech(it.body_md)}`).join("\n\n");
        db()
          .prepare(
            `INSERT INTO chapters (id, document_id, number, title, text, sort_order, kind, audio_text, audio_text_model)
             VALUES (?, ?, ?, ?, ?, ?, 'summary', ?, 'katalog')
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, text = excluded.text, audio_text = excluded.audio_text, audio_text_model = 'katalog'`
          )
          .run(chapterId, documentId, i + 1, k.title, text, i + 1, spoken);
        chapters++;
      }
      if (opts.cards) {
        // Gleiche Karten-ID je Eintrag: der Lernstand bleibt beim erneuten Erzeugen erhalten
        const up = db().prepare(
          `INSERT INTO cards (id, document_id, chapter_id, question, answer, difficulty, source)
           VALUES (?, ?, NULL, ?, ?, 'medium', 'katalog')
           ON CONFLICT(id) DO UPDATE SET question = excluded.question, answer = excluded.answer`
        );
        for (const it of list) {
          up.run(`card-${it.id}`, documentId, k.question(it.title), it.body_md);
          cards++;
        }
      }
    });
    db().prepare("UPDATE documents SET page_count = 0 WHERE id = ?").run(documentId);
  })();
  return { documentId, chapters, cards, skippedUncertain };
}
