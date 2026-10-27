// Lernkarten für ein ganzes Dokument: alle Kapitel, in Stücken
// Pro Stück: Gemma sucht Aufgaben + Beispiele mit Lösung, Ausgabe JSON
// Mehrteilige Aufgaben = eine Karte, Dubletten über Stückgrenzen raus
// Nichts erfinden: ohne Aufgaben leere Liste
// Events: cards.start → chapter/chunk/progress → done/failed/canceled
import { randomUUID } from "node:crypto";
import { db } from "../../db";
import { emit as emitEvent } from "../events";
import { isAvailable as llmAvailable } from "../llm";
import { effective } from "../llmConfig";
import { CHUNK_CHARS, CHUNK_OVERLAP, MIN_CHAPTER_CHARS, type ChapterRow } from "./types";
import { SKIP_KINDS, dedupKey, chunkText, extractCardsFromChunk } from "./extract";
import { runJob } from "../../log/jobs";

// Abbruch-Flags: geprüft zwischen LLM-Aufrufen, laufende Aufrufe laufen zu Ende
const cancelFlags = new Set<string>();
const activeRuns = new Set<string>();

export function isCardBuildActive(docId: string): boolean {
  return activeRuns.has(docId);
}

export function cancelCardBuild(docId: string): boolean {
  if (!activeRuns.has(docId)) return false;
  cancelFlags.add(docId);
  return true;
}

export interface BuildOptions {
  // true: alle KI-Karten löschen und alles neu
  // false: Kapitel mit KI-Karten überspringen, Fortsetzen nach Abbruch
  rebuild?: boolean;
  // Modell: Aufrufer > Settings > ENV; ohne Modell kein Start
  model?: string;
}

async function runCardBuildImpl(
  docId: string,
  opts: BuildOptions = {}
): Promise<void> {
  if (activeRuns.has(docId)) return;
  activeRuns.add(docId);
  cancelFlags.delete(docId);
  const rebuild = opts.rebuild === true;

  const d = db();
  const doc = d
    .prepare("SELECT id, language FROM documents WHERE id = ?")
    .get(docId) as { id: string; language: string } | undefined;
  if (!doc) {
    activeRuns.delete(docId);
    emitEvent({
      phase: "cards.failed",
      docId,
      message: "document not found",
    });
    return;
  }

  if (!(await llmAvailable())) {
    activeRuns.delete(docId);
    emitEvent({
      phase: "cards.failed",
      docId,
      message: "no LLM provider available",
    });
    return;
  }

  // Modell fest pinnen: Aufrufer → Settings → PM_OLLAMA_MODEL
  // Ohne Modell nicht starten: Stunden auf dem falschen Modell sind schlimmer
  const pinnedModel =
    (opts.model && opts.model.trim()) ||
    effective("ollamaModel", "PM_OLLAMA_MODEL");
  if (!pinnedModel) {
    activeRuns.delete(docId);
    emitEvent({
      phase: "cards.failed",
      docId,
      message:
        "Default Ollama Model is empty (Settings → LLM). Pick a model " +
        "(e.g. gemma4:e4b) before starting a card build.",
    });
    console.warn(
      `[cards.build] refused to start: Settings.ollamaModel is empty. ` +
        `Set Settings → Default Ollama Model and retry.`
    );
    return;
  }
  console.log(`[cards.build] pinned model="${pinnedModel}" for doc=${docId}`);

  const lang: "de" | "en" = doc.language === "de" ? "de" : "en";

  // Kapitel in Anzeige-Reihenfolge, Verzeichnisse und Meta überspringen
  const chapters = d
    .prepare(
      `SELECT id, number, title, text, start_page, sort_order,
              COALESCE(kind, 'content') as kind
       FROM chapters
       WHERE document_id = ?
       ORDER BY sort_order`
    )
    .all(docId) as ChapterRow[];

  const usable = chapters.filter(
    (c) =>
      c.text &&
      c.text.length >= MIN_CHAPTER_CHARS &&
      !SKIP_KINDS.has(c.kind)
  );

  // Kapitelübersicht als Orientierung für das Modell, eine Zeile pro Kapitel
  const docOutline = chapters
    .map((c) => `  ${c.number}. ${c.title}`)
    .join("\n");

  // Fortsetzen: vorhandene KI-Karten pro Kapitel zählen
  if (rebuild) {
    d.prepare(
      "DELETE FROM cards WHERE document_id = ? AND source = 'ai_generated'"
    ).run(docId);
  }
  const existingByChapter = new Map<string, number>();
  if (!rebuild) {
    const rows = d
      .prepare(
        `SELECT chapter_id, COUNT(*) as n FROM cards
         WHERE document_id = ? AND source = 'ai_generated' AND chapter_id IS NOT NULL
         GROUP BY chapter_id`
      )
      .all(docId) as Array<{ chapter_id: string; n: number }>;
    for (const r of rows) existingByChapter.set(r.chapter_id, r.n);
  }

  const skippedCount = usable.filter((c) =>
    existingByChapter.has(c.id)
  ).length;
  const totalExistingCards = Array.from(existingByChapter.values()).reduce(
    (s, n) => s + n,
    0
  );

  emitEvent({
    phase: "cards.start",
    docId,
    total: usable.length,
    current: skippedCount,
    message: rebuild
      ? undefined
      : skippedCount > 0
        ? `resume: ${skippedCount} chapters already done (${totalExistingCards} cards)`
        : undefined,
  });

  try {

    const insert = d.prepare(
      `INSERT INTO cards
         (id, document_id, chapter_id, question, answer, difficulty, source_page, source)
       VALUES (?, ?, ?, ?, ?, 'medium', ?, 'ai_generated')`
    );

    let totalInserted = totalExistingCards;
    let chaptersCompleted = skippedCount;
    for (let cIdx = 0; cIdx < usable.length; cIdx++) {
      if (cancelFlags.has(docId)) {
        emitEvent({
          phase: "cards.canceled",
          docId,
          current: chaptersCompleted,
          total: usable.length,
        });
        return;
      }
      const ch = usable[cIdx];

      // Fortsetzen: Kapitel mit Karten überspringen, Fortschritt trotzdem melden
      const existing = existingByChapter.get(ch.id);
      if (existing && existing > 0) {
        emitEvent({
          phase: "cards.chapter",
          docId,
          chapterId: ch.id,
          chapterNumber: ch.number,
          current: cIdx + 1,
          total: usable.length,
          message: `${ch.title} · ${existing} ↻ resume`,
        });
        continue;
      }

      emitEvent({
        phase: "cards.chapter",
        docId,
        chapterId: ch.id,
        chapterNumber: ch.number,
        current: cIdx,
        total: usable.length,
        message: ch.title,
      });

      const chunks = chunkText(ch.text, CHUNK_CHARS, CHUNK_OVERLAP);
      const seenQuestions = new Set<string>();

      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        if (cancelFlags.has(docId)) {
          emitEvent({
            phase: "cards.canceled",
            docId,
            current: cIdx,
            total: usable.length,
          });
          return;
        }
        emitEvent({
          phase: "cards.chunk",
          docId,
          chapterId: ch.id,
          chapterNumber: ch.number,
          current: chunkIdx + 1,
          total: chunks.length,
        });

        const cards = await extractCardsFromChunk(
          chunks[chunkIdx],
          ch.title,
          ch.number,
          lang,
          pinnedModel,
          docOutline
        );

        const tx = d.transaction(() => {
          for (const card of cards) {
            const key = dedupKey(card.question);
            if (seenQuestions.has(key)) continue;
            seenQuestions.add(key);
            insert.run(
              randomUUID(),
              docId,
              ch.id,
              card.question.trim(),
              card.answer.trim(),
              ch.start_page
            );
            totalInserted++;
          }
        });
        tx();

        emitEvent({
          phase: "cards.progress",
          docId,
          chapterId: ch.id,
          chapterNumber: ch.number,
          current: totalInserted,
        });
      }
      chaptersCompleted++;
    }

    emitEvent({
      phase: "cards.done",
      docId,
      total: usable.length,
      current: totalInserted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cards.build] ${docId} failed:`, err instanceof Error ? err.stack : err);
    emitEvent({
      phase: "cards.failed",
      docId,
      message: msg,
    });
  } finally {
    activeRuns.delete(docId);
    cancelFlags.delete(docId);
  }
}

export function runCardBuild(...args: Parameters<typeof runCardBuildImpl>): ReturnType<typeof runCardBuildImpl> {
  return runJob("cards", "cards", { docId: args[0] }, () => runCardBuildImpl(...args));
}
