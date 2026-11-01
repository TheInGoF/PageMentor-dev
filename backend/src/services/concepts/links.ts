// Verbindungen prüfen und aufräumen, ohne Modell. „A baut auf B“ gilt als gesichert, wenn Gemma sie in zwei
// Kapiteln gefunden hat, wenn B im selben Heft vor A erklärt wird oder wenn B in einem anderen Heft erklärt wird.
// Gegenseitige Paare behalten die Richtung, deren Grundlage früher erklärt wird; bei Gleichstand gilt keine.
// Kapitel ohne Wort im Titel (Aufgabenfetzen wie „1111 1110.“) und Sprachhefte gehören nicht ins Fachbegriffsnetz
import { db } from "../../db";

export interface RawLink {
  a: string;
  b: string;
  chapter: string;
  doc: string;
  // Lage des Kapitels im Heft
  pos: number;
}
// Erste Erklärung je Begriff und Heft: Begriff → Heft → Lage
export type Explains = Map<string, Map<string, number>>;

export const linkKey = (a: string, b: string) => `${a}|${b}`;

// Reine Regel, gut testbar
export function confirmLinks(links: RawLink[], explains: Explains): Set<string> {
  const byPair = new Map<string, RawLink[]>();
  for (const l of links) byPair.set(linkKey(l.a, l.b), [...(byPair.get(linkKey(l.a, l.b)) ?? []), l]);
  const first = (c: string, doc: string) => explains.get(c)?.get(doc);
  const elsewhere = (c: string, doc: string) => [...(explains.get(c)?.keys() ?? [])].some((d) => d !== doc);
  const out = new Set<string>();
  for (const [k, ls] of byPair) {
    if (new Set(ls.map((l) => l.chapter)).size >= 2) {
      out.add(k);
      continue;
    }
    const { a, b, doc, pos } = ls[0];
    const fb = first(b, doc);
    if (fb === undefined) {
      if (elsewhere(b, doc)) out.add(k);
      continue;
    }
    // B muss bis zum Kapitel der Verbindung erklärt sein; bei Gegenseitigkeit vor A
    const fa = first(a, doc);
    const mutual = byPair.has(linkKey(b, a));
    if (fb <= pos && (!mutual || fa === undefined || fb < fa)) out.add(k);
  }
  return out;
}

const POS = "ch.sort_order * 1000000 + ch.number";

// Gesicherte Verbindungen aus der Datenbank, Schlüssel „begriff|grundlage“
export function linkStatus(): Set<string> {
  const d = db();
  const links = d
    .prepare(`SELECT l.concept_id AS a, l.needs_id AS b, l.chapter_id AS chapter, ch.document_id AS doc, ${POS} AS pos FROM concept_links l JOIN chapters ch ON ch.id = l.chapter_id`)
    .all() as RawLink[];
  const rows = d
    .prepare(
      `SELECT m.concept_id AS c, ch.document_id AS doc, MIN(${POS}) AS pos FROM concept_mentions m JOIN chapters ch ON ch.id = m.chapter_id
        WHERE m.role = 'explains' GROUP BY m.concept_id, ch.document_id`
    )
    .all() as Array<{ c: string; doc: string; pos: number }>;
  const explains: Explains = new Map();
  for (const r of rows) {
    if (!explains.has(r.c)) explains.set(r.c, new Map());
    explains.get(r.c)!.set(r.doc, r.pos);
  }
  return confirmLinks(links, explains);
}

// Kapiteltitel mit mindestens drei Buchstaben; „1111 1110.“ ist keiner
export function wordTitle(title: string | null): boolean {
  return ((title ?? "").match(/\p{L}/gu) ?? []).length >= 3;
}

// Sprachkurs laut Einstellung, sonst laut zweiter Sprache (wie learnSettings)
export const LANGUAGE_DOC = "CASE WHEN d.learn_kind IN ('language', 'subject') THEN d.learn_kind = 'language' ELSE d.second_language IS NOT NULL END";

// Fundstellen und Verbindungen aus Kapiteln ohne Wort-Titel und aus Sprachheften entfernen, verwaiste Begriffe dazu
export function cleanupConcepts(): { chapters: number; concepts: number } {
  const d = db();
  const used = d
    .prepare("SELECT ch.id, ch.title FROM chapters ch WHERE ch.id IN (SELECT chapter_id FROM concept_mentions UNION SELECT chapter_id FROM concept_links)")
    .all() as Array<{ id: string; title: string | null }>;
  const junk = used.filter((c) => !wordTitle(c.title)).map((c) => c.id);
  const lang = (d.prepare(`SELECT ch.id FROM chapters ch JOIN documents d ON d.id = ch.document_id WHERE ${LANGUAGE_DOC}`).all() as Array<{ id: string }>).map((c) => c.id);
  const gone = [...new Set([...junk, ...lang])];
  let concepts = 0;
  d.transaction(() => {
    for (const id of gone) {
      d.prepare("DELETE FROM concept_mentions WHERE chapter_id = ?").run(id);
      d.prepare("DELETE FROM concept_links WHERE chapter_id = ?").run(id);
    }
    concepts = d
      .prepare(
        "DELETE FROM concepts WHERE id NOT IN (SELECT concept_id FROM concept_mentions) AND id NOT IN (SELECT needs_id FROM concept_links) AND id NOT IN (SELECT concept_id FROM concept_links)"
      )
      .run().changes;
  })();
  return { chapters: gone.length, concepts };
}
