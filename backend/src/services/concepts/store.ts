// Begriffs-Datenbank über alle Hefte: Fachbegriffe, wo sie erklärt oder benutzt werden, worauf sie aufbauen.
// Gleiche Begriffe aus verschiedenen Heften sind ein Eintrag (Schlüssel: normalisierter Name)
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { db } from "../../db";

export function ensureConceptTables(d: Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS concepts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      norm TEXT NOT NULL UNIQUE,
      definition TEXT,
      embedding BLOB
    );
    CREATE TABLE IF NOT EXISTS concept_mentions (
      concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL,
      role TEXT NOT NULL,
      definition TEXT,
      PRIMARY KEY (concept_id, chapter_id)
    );
    CREATE INDEX IF NOT EXISTS concept_mentions_chapter ON concept_mentions(chapter_id);
    CREATE TABLE IF NOT EXISTS concept_links (
      concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
      needs_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      PRIMARY KEY (concept_id, needs_id, chapter_id)
    );
    CREATE INDEX IF NOT EXISTS concept_links_needs ON concept_links(needs_id);
  `);
  const cols = d.prepare("PRAGMA table_info(chapters)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "concepts_stamp")) d.exec("ALTER TABLE chapters ADD COLUMN concepts_stamp TEXT");
}

// "Codewörter" und "Codewort", "Kanal-Kapazität" und "Kanalkapazität" sind derselbe Begriff
export function normalizeConcept(name: string): string {
  let n = name
    .toLowerCase()
    .normalize("NFC")
    .replace(/\(.*?\)/g, "")
    .replace(/[äöü]/g, (c) => ({ ä: "a", ö: "o", ü: "u" })[c]!)
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "");
  // Grobe Pluralendungen; kurze Wörter bleiben, sonst fallen "Bus" und "Bu" zusammen
  if (n.length > 6) n = n.replace(/(ungen|en|er|e|n|s)$/, (m) => (m === "ungen" ? "ung" : ""));
  return n;
}

export interface ExtractedConcept {
  name: string;
  definition: string;
  explains: boolean;
  needs: string[];
}

function upsertConcept(name: string, definition: string): string {
  const d = db();
  const norm = normalizeConcept(name);
  const hit = d.prepare("SELECT id, definition FROM concepts WHERE norm = ?").get(norm) as { id: string; definition: string | null } | undefined;
  if (hit) {
    // Längere Erklärung gewinnt, der zuerst gesehene Name bleibt
    if (definition && (!hit.definition || definition.length > hit.definition.length)) d.prepare("UPDATE concepts SET definition = ?, embedding = NULL WHERE id = ?").run(definition, hit.id);
    return hit.id;
  }
  const id = randomUUID();
  d.prepare("INSERT INTO concepts (id, name, norm, definition) VALUES (?, ?, ?, ?)").run(id, name.trim(), norm, definition || null);
  return id;
}

// Ergebnis eines Kapitels speichern; ersetzt einen früheren Lauf desselben Kapitels
export function saveChapterConcepts(chapterId: string, documentId: string, items: ExtractedConcept[], stamp: string): void {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM concept_mentions WHERE chapter_id = ?").run(chapterId);
    d.prepare("DELETE FROM concept_links WHERE chapter_id = ?").run(chapterId);
    const ids = new Map<string, string>();
    for (const it of items) {
      if (normalizeConcept(it.name).length < 3) continue;
      const id = upsertConcept(it.name, it.definition);
      ids.set(it.name, id);
      d.prepare("INSERT OR REPLACE INTO concept_mentions (concept_id, chapter_id, document_id, role, definition) VALUES (?, ?, ?, ?, ?)").run(
        id,
        chapterId,
        documentId,
        it.explains ? "explains" : "uses",
        it.definition || null
      );
    }
    for (const it of items) {
      const from = ids.get(it.name);
      if (!from) continue;
      for (const need of it.needs) {
        if (normalizeConcept(need).length < 3) continue;
        const to = ids.get(need) ?? upsertConcept(need, "");
        if (to !== from) d.prepare("INSERT OR IGNORE INTO concept_links (concept_id, needs_id, chapter_id) VALUES (?, ?, ?)").run(from, to, chapterId);
      }
    }
    // Begriffe ohne Fundstelle und ohne Verbindung fallen weg
    d.prepare(
      "DELETE FROM concepts WHERE id NOT IN (SELECT concept_id FROM concept_mentions) AND id NOT IN (SELECT needs_id FROM concept_links) AND id NOT IN (SELECT concept_id FROM concept_links)"
    ).run();
    d.prepare("UPDATE chapters SET concepts_stamp = ? WHERE id = ?").run(stamp, chapterId);
  })();
}
