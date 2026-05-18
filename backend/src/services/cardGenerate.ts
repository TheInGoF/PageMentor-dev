/**
 * Card generation — one button, all chapters, chunked.
 *
 * The flow this replaces (v1.18.183 and earlier):
 *   - Heuristic regex extractor that found "Aufgabe X.Y" markers and
 *     paired them with following lines. Brittle, missed everything
 *     that wasn't a numbered marker.
 *   - RAG-fill step that looked up answers via embeddings for
 *     extractor-found questions without answers. Decoupled from
 *     extraction so the two pieces could disagree.
 *   - Per-chapter "✨ AI cards" modal that asked Gemma to invent N
 *     cards from chapter text. Capped at 15 because we sent 20k
 *     chars in one go and longer context degraded output.
 *   - Per-chapter preprocess step that ran a separate classify +
 *     extract pipeline, caching results in chapters.card_text. Two
 *     models of "what does this chapter say" living in two places.
 *
 * The new flow:
 *   - One call per document: walk every chapter in sort_order, for
 *     each chapter slice the text into ~4 kB chunks (with ~500 B
 *     overlap so an exercise that straddles a chunk boundary is
 *     still visible in at least one chunk), ask Gemma "find all
 *     exercises + worked examples in this chunk, return JSON".
 *   - Multi-part (a/b/c) exercises become ONE card: question carries
 *     the intro + every subpart, answer carries every subpart's
 *     answer. The model is explicitly instructed not to split them.
 *   - Dedup across chunks: question text + chapter id is the key.
 *     The overlap region means the same exercise can appear in two
 *     adjacent chunks; we keep the first one we see.
 *   - No invented cards. The prompt says "only extract what's in the
 *     text" — if a chunk has no exercises we return an empty array.
 *   - All Gemma calls go through withGemmaLock so audio preprocess
 *     and card build don't race for the GPU.
 *
 * Progress: emits cards.start, then cards.chapter / cards.chunk /
 * cards.progress as we work through, and cards.done / cards.failed /
 * cards.canceled at the end. SSE consumers in the frontend already
 * subscribe to these via /api/audio/stream/:docId (yes, the audio
 * stream is the canonical SSE channel for the document — events.ts
 * is per-doc, not per-domain).
 */

import { randomUUID } from "node:crypto";
import { db } from "../db";
import { emit as emitEvent } from "./events";
import { withGemmaLock } from "./gemmaLock";
import { generate as llmGenerate, isAvailable as llmAvailable } from "./llm";
import { effective } from "./llmConfig";
import { cleanupHints } from "./promptHints";

const CHUNK_CHARS = 4000;
const CHUNK_OVERLAP = 500;
const MIN_CHAPTER_CHARS = 200;

interface Card {
  question: string;
  answer: string;
}

interface ChapterRow {
  id: string;
  number: number;
  title: string;
  text: string;
  start_page: number;
  sort_order: number;
  kind: string;
}

// Cancellation registry — UI calls DELETE /api/cards/build/:docId
// and we observe the flag between LLM calls. We never interrupt an
// in-flight call (Ollama doesn't support that gracefully), just stop
// scheduling further ones.
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
  /** If true, wipe every existing ai_generated card before starting
   *  and walk all chapters. If false (default), walk chapters but
   *  SKIP any chapter that already has ai_generated cards — used to
   *  resume a build after a crash, restart, or cancel. */
  rebuild?: boolean;
}

export async function runCardBuild(
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

  // Pin the model explicitly per call. Audiobook preprocess already
  // does this via body.model from the UI's model picker; card build
  // didn't, so it relied on the global Settings default which the
  // pickProvider cache could hold as "" if the config wasn't read
  // when the candidate snapshot was built. Symptom: cards.build ran
  // against whatever the arbiter had loaded (qwen) while audio
  // happily used gemma4:e4b.
  //
  // If neither Settings nor ENV gives us a value, refuse to start —
  // an unpinned run will burn hours producing garbage on the wrong
  // model, hard-fail is the kinder default.
  const pinnedModel = effective("ollamaModel", "PM_OLLAMA_MODEL");
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

  // Walk all chapters in display order. We skip non-content kinds
  // (index, references, meta) because they'll never contain real
  // exercises and would just waste Gemma calls.
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

  // Document-wide outline: every chapter title we'll send into the
  // chunk prompt as orientation. Helps the model decide "this chunk
  // is part of chapter 5.3, the previous one was 5.2, so when I see
  // 'Beispiel 5.3' inside this chunk it really belongs here". Kept
  // short — one line per chapter, no body text.
  const docOutline = chapters
    .map((c) => `  ${c.number}. ${c.title}`)
    .join("\n");

  // Resume support: count existing ai_generated cards per chapter so
  // we can skip chapters that already finished. In rebuild mode we
  // wipe first, then nothing is skipped.
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

      // Resume: skip chapters that already have cards from a previous
      // (partial) run. Emit a chapter event with the existing count so
      // the UI shows progress hopping over skipped chapters too.
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

// Chapter kinds that never contain exercises worth extracting.
const SKIP_KINDS = new Set(["index", "references", "meta", "other"]);

function dedupKey(q: string): string {
  return q
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9äöüß ]/g, "")
    .trim()
    .slice(0, 160);
}

/** Slice text into chunks of `size` chars with `overlap` chars of
 *  back-overlap into the previous chunk. Tries to break on paragraph
 *  boundaries (double newline) when one is within ~300 chars of the
 *  ideal cut, so we don't shred exercises mid-sentence. */
function chunkText(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + size);
    if (end < text.length) {
      // Look for a paragraph break within 300 chars of the ideal cut.
      const window = text.slice(Math.max(pos, end - 300), end);
      const lastBreak = window.lastIndexOf("\n\n");
      if (lastBreak > 0) {
        end = Math.max(pos, end - 300) + lastBreak;
      }
    }
    chunks.push(text.slice(pos, end));
    if (end >= text.length) break;
    pos = end - overlap;
  }
  return chunks;
}

async function extractCardsFromChunk(
  chunk: string,
  chapterTitle: string,
  chapterNumber: number,
  lang: "de" | "en",
  pinnedModel: string,
  docOutline: string
): Promise<Card[]> {
  const system =
    lang === "de"
      ? `Du extrahierst Lernkarten AUS DEM GEGEBENEN TEXT. Lieber 3 saubere Karten als 10 mittelmäßige.

WAS DU EXTRAHIERST:
1. Explizit markierte Aufgaben mit Lösung: "Übung 2.1", "Aufgabe 5.3", "Einsendeaufgabe", "Selbstkontrollfrage" — Frage = Aufgabentext, Antwort = die im Text gegebene Lösung.
2. Worked-Examples mit Rechenweg: "Beispiel 3.2: …" gefolgt von Lösung/Rechnung — Frage = Aufgabenstellung des Beispiels, Antwort = der dort gezeigte Rechenweg.
3. Mehrteilige Aufgaben (a), b), c)) sind EINE Karte: Frage enthält Einleitung + alle Teile, Antwort enthält alle Teilantworten in derselben Reihenfolge.

WAS DU NICHT EXTRAHIERST (gib einfach kein Item dafür aus):
- Rhetorische Fragen im Fließtext ("Nehmen wir an, dass …", "Stellen Sie sich vor …", "Sehen Sie, dass …") — das sind didaktische Stilmittel, keine Aufgaben.
- Überschriften alleine (z.B. "## Natürliche Redundanz") — eine Überschrift ohne erklärten Inhalt wird KEINE Karte.
- Definitionen ohne explizite Frage-Aufforderung.
- Karten wo die Antwort eine bloße Wiederholung der Frage wäre.
- Karten wo die Antwort kürzer als 30 Zeichen wäre und keinen eigenständigen Inhalt trägt.

QUALITÄTS-GATE (gehe jede potenzielle Karte durch):
- Ist die Antwort eigenständiger Inhalt (≠ Wiederholung/Echo der Frage)? Wenn nein → weglassen.
- Hat die Antwort mindestens 30 Zeichen erkennbaren Lerninhalt? Wenn nein → weglassen.
- Wäre die Frage in einer Klausur sinnvoll? Wenn die Antwort nur "es kommt drauf an" / "wie oben" / die Überschrift wäre → weglassen.

Wenn dieser Chunk gar nichts Karten-Würdiges enthält: gib [] zurück. Das ist die richtige Antwort und kein Fehler.

${cleanupHints("de")}

AUSGABE: AUSSCHLIESSLICH ein valides JSON-Array. Keine Einleitung, keine Codefences, keine Kommentare.
Format: [{"question": "…", "answer": "…"}, …]`
      : `You extract flashcards FROM THE PROVIDED TEXT. Better 3 clean cards than 10 mediocre ones.

WHAT TO EXTRACT:
1. Explicitly marked exercises with solution: "Exercise 2.1", "Problem 5.3", "Self-check question" — question = exercise text, answer = the solution shown in the text.
2. Worked examples with reasoning: "Example 3.2: …" followed by a solution/computation — question = the example's problem, answer = the worked solution from the text.
3. Multi-part exercises (a), b), c)) become ONE card: question contains the intro + all parts, answer contains all part-answers in the same order.

WHAT YOU DO NOT EXTRACT (just skip — no item):
- Rhetorical questions in prose ("Suppose that …", "Imagine …", "You can see that …") — these are pedagogical devices, not exercises.
- Standalone headings (e.g. "## Natural Redundancy") — a heading without explained content does NOT become a card.
- Definitions without an explicit prompt.
- Cards where the answer is a mere repetition of the question.
- Cards where the answer would be shorter than 30 characters with no real content.

QUALITY GATE (run each potential card through):
- Is the answer independent content (≠ echo of the question)? If no → drop it.
- Does the answer contain at least 30 characters of recognisable learning content? If no → drop it.
- Would this question make sense on an exam? If the answer is just "it depends" / "see above" / the heading → drop it.

If this chunk contains nothing card-worthy: return []. That's the correct answer and not an error.

${cleanupHints("en")}

OUTPUT: a valid JSON array ONLY. No prose, no code fences, no comments.
Format: [{"question": "…", "answer": "…"}, …]`;

  // Include the document-wide outline (chapter titles) and which
  // chapter THIS chunk belongs to. Helps the model recognize sub-
  // headings inside the chunk as belonging to the current chapter,
  // and lets it tell "Beispiel 5.2" apart from "Beispiel 5.3" when
  // both appear nearby.
  const userPrompt =
    lang === "de"
      ? `Dokument-Übersicht (alle Kapitel):\n${docOutline}\n\nDieser Chunk gehört zu Kapitel ${chapterNumber}: ${chapterTitle}\n\nChunk-Text:\n${chunk}`
      : `Document outline (all chapters):\n${docOutline}\n\nThis chunk belongs to Chapter ${chapterNumber}: ${chapterTitle}\n\nChunk text:\n${chunk}`;

  const result = await withGemmaLock(
    `cards.build chunk (ch=${chapterNumber})`,
    () =>
      llmGenerate({
        prompt: userPrompt,
        system,
        model: pinnedModel,
        options: {
          temperature: 0.2,
          top_p: 0.9,
          num_ctx: 16384,
          num_predict: 8192,
        },
      })
  );

  const parsed = parseCardArray(result.response);
  if (parsed.length === 0 && result.response.trim().length > 0) {
    // Defensive: log a tail of the response so we can see WHY parsing
    // failed without dumping a 30 KB blob into the log.
    const head = result.response.slice(0, 240).replace(/\s+/g, " ");
    const tail = result.response.slice(-240).replace(/\s+/g, " ");
    console.warn(
      `[cards.build] empty parse from chunk (ch=${chapterNumber}). ` +
        `model=${result.model} done=${result.doneReason ?? "?"} ` +
        `out_tokens=${result.outputTokens ?? "?"}\n  head: ${head}\n  tail: ${tail}`
    );
  }
  return parsed;
}

function parseCardArray(raw: string): Card[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // Fast path: well-formed JSON.
  try {
    const arr = JSON.parse(trimmed) as unknown;
    return normalizeArray(arr);
  } catch {
    // Fallback: pull out the first balanced [ ... ] block from the
    // response; tolerates "[...]\n\nHere are the cards" leading prose.
    const isolated = extractFirstJsonArray(trimmed);
    if (!isolated) return [];
    try {
      return normalizeArray(JSON.parse(isolated));
    } catch {
      return [];
    }
  }
}

function normalizeArray(arr: unknown): Card[] {
  if (!Array.isArray(arr)) return [];
  const out: Card[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const q = typeof rec.question === "string" ? rec.question.trim() : "";
    const a = typeof rec.answer === "string" ? rec.answer.trim() : "";
    const reason = qualityRejection(q, a);
    if (reason) {
      console.log(`[cards.build] dropping low-quality card (${reason}): q="${q.slice(0, 60)}…"`);
      continue;
    }
    out.push({ question: q, answer: a });
  }
  return out;
}

/** Returns a short reason string if this Q/A pair should be DROPPED,
 *  or null if it's good enough to keep. Belt-and-braces over the
 *  prompt's quality gate — if the model echoes a heading or answers
 *  with a slice of the question, we filter it here so it never lands
 *  in the user's card deck.
 *
 *  Symptoms we've seen in real runs:
 *   - "Was ist natürliche Redundanz?" / "Natürliche Redundanz"  → echo
 *   - long question / 5-word answer that's the question's first line → too short
 *   - "Sehen Sie, dass …?" / "Sehen Sie, dass …" → rhetorical-fragment dup
 */
function qualityRejection(q: string, a: string): string | null {
  if (q.length < 8) return "question too short";
  if (a.length < 30) return "answer too short (<30 chars)";

  // Echo detection: normalised answer is contained verbatim in the
  // question, or vice versa. Catches "Was ist X?" / "X" and longer
  // variants like "… Mehrheitsentscheidung durch …" appearing as both.
  const nq = normalizeForCompare(q);
  const na = normalizeForCompare(a);
  if (nq === na) return "answer equals question";
  if (na.length <= nq.length / 2 && nq.includes(na))
    return "answer is a substring of the question";
  if (nq.length <= na.length / 2 && na.includes(nq))
    return "question is a substring of the answer";

  return null;
}

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[„""''`.,;:!?()\[\]{}]/g, "")
    .trim();
}

/** Same balanced-bracket recovery as cardPreprocess.ts uses — duplicated
 *  here on purpose so this service has no compile dependency on the
 *  old preprocess module that's being removed. */
function extractFirstJsonArray(s: string): string | null {
  const start = s.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
