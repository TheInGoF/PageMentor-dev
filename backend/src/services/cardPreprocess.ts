/**
 * Card preprocessing — turns a raw chapter text into a card-ready form.
 *
 * Two output modes, both cached in `chapters.card_text` + `_type`:
 *
 *   "qa_pairs": the chapter looks like an exam / exercise sheet.
 *               We extract structured {question, answer} pairs and
 *               store them as JSON. The cards generator imports
 *               these 1:1 without a second LLM round-trip.
 *
 *   "content":  the chapter is regular study material. We rewrite
 *               the prose with PDF-mangled formulas reconstructed
 *               to clean LaTeX so the downstream AI card-gen has
 *               a clean source to draw from.
 *
 * Mode detection happens via a tiny classification call first (cheap,
 * ~5 s) so we don't waste a long extraction prompt on the wrong mode.
 *
 * Idempotent — re-running on the same chapter overwrites the cache.
 * Manual trigger only; not part of the upload pipeline (would slow
 * uploads of large docs without proven benefit, and not every chapter
 * needs preprocessing).
 */

import { randomUUID } from "node:crypto";
import { db } from "../db";
import { generate, isAvailable as llmAvailable } from "./llm";
// Shared with audioPreprocess — serialises every Gemma call across
// the whole process. Without it, parallel "Vorbereiten"-clicks (or a
// batch run before frontend serialisation kicks in) burst the GPU
// arbiter into a flapping state with parallel model loads.
import { withGemmaLock } from "./gemmaLock";

export type CardTextType = "qa_pairs" | "content";

export interface QaPair {
  question: string;
  /** Optional — many exam sheets ship without reference solutions.
   *  The Cards-Generator stores those as cards with answer = "". */
  answer: string;
  /** Optional: a section/aufgaben-Nummer like "4.2a" from the source,
   *  preserved if the LLM detects it. UI doesn't surface this yet. */
  number?: string;
}

export interface CardPreprocessResult {
  type: CardTextType;
  /** For qa_pairs: JSON-stringified QaPair[].
   *  For content:  the cleaned prose with LaTeX formulas. */
  text: string;
  model: string;
  cached: boolean;
  /** Convenience: parsed JSON for qa_pairs, undefined for content. */
  pairs?: QaPair[];
}

// ---------------------------------------------------------------------
// Stage 1 — classification
// ---------------------------------------------------------------------

const CLASSIFY_SYSTEM = `Du klassifizierst einen Kapitel-Auszug als entweder

  "qa_pairs"  → wenn der Auszug aus Klausur-/Übungs-/Aufgaben-Blöcken besteht (durchnummerierte Aufgaben, Frage-Antwort-Strukturen, Multiple-Choice, Selbstkontrolle)
  "content"   → wenn der Auszug normaler Lehrtext ist (Definitionen, Erklärungen, Beispiele in Fließtext)

Mischformen klassifizierst du nach dem überwiegenden Charakter. Wenn unsicher: "content".

Antworte AUSSCHLIESSLICH mit einem einzigen Wort: "qa_pairs" oder "content". Kein Markdown, keine Erklärung.`;

/** Heuristic title-and-content sniff. Returns "qa_pairs" if we're
 *  very confident, "content" if confident the other way, and "unknown"
 *  for the ambiguous middle which then asks the LLM.
 *
 *  Most exam/exercise chapters in study booklets are unambiguously
 *  named — "Aufgaben zur Selbstüberprüfung", "Übungsklausur",
 *  "Klausur 2023", "Selbsttest", "Wiederholungsfragen". Sending those
 *  to the LLM is waste — and worse, the LLM occasionally answers wrong
 *  (Gemma's classify call returned an empty 64-token response on one
 *  of these and defaulted to "content"). Title-match is ~100% reliable
 *  on the cases we care about, runs in microseconds, costs nothing. */
function heuristicClassify(
  title: string,
  text: string
): CardTextType | "unknown" {
  const t = (title || "").toLowerCase();

  // Strong title signals — almost certainly an exam/exercise chapter.
  // Includes German + English variants we've actually seen in study
  // material from the user's WBH booklets.
  const qaTitleHits = [
    /\baufgaben?\b/, // "Aufgaben", "Aufgabe 3"
    /einsendeaufgabe/, // "Einsendeaufgaben", "Einsendeaufgabe (ESA)"
    /aufgabenblatt/, // "Einsendeaufgaben-Aufgabenblatt"
    /\bübung(en)?\b/,
    /\bselbst(?:überprüfung|kontrolle|test)\b/,
    /\bklausur(?:en|-trainer)?\b/,
    /\bwiederholungs?(?:frag|aufgab)/,
    /\bquiz\b/,
    /\bprüfungs?aufgab/,
    /\besa\b/, // common abbreviation for Einsendeaufgaben at WBH
    /\bexercises?\b/,
    /\bexam(?:s|inations?)?\b/,
    /\bself[- ]?(?:check|test|assessment)\b/,
    /\breview questions?\b/,
  ];
  if (qaTitleHits.some((re) => re.test(t))) return "qa_pairs";

  // Strong content signals — typical Lehrtext-Headings.
  const contentTitleHits = [
    /^\d+\s*[-:.]?\s+\w/, // "1. Einführung", "2 Diskrete Quellen"
    /\beinführung\b/,
    /\bzusammenfassung\b/,
    /\bdefinition(en)?\b/,
    /\bübersicht\b/,
    /\bintroduction\b/,
    /\bsummary\b/,
    /\boverview\b/,
  ];

  // Content-signaled title alone isn't decisive — a chapter can be
  // named "2. Aufgaben" — only treat as content if title fits AND
  // text doesn't look like an exam sheet.
  const titleSaysContent = contentTitleHits.some((re) => re.test(t));

  // Content-density check: count lines that LOOK like numbered exam
  // items ("3.1 ...", "Aufgabe 4: ...", "1) ..."). If a substantial
  // fraction of non-empty lines match, it's likely qa_pairs.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return "unknown";

  const exemPatterns = [
    /^\d+(?:\.\d+){0,2}\s*[a-z]?\s*[).:]\s+\S/i, // "3.1)", "4:", "1.2.3."
    /^aufgabe\s+\d/i,
    /^übung\s+\d/i,
    /^frage\s+\d/i,
    /^task\s+\d/i,
    /^question\s+\d/i,
    /^\([a-z]\)\s+\S/i, // "(a) ...", "(b) ..."
  ];
  const exemHits = lines.filter((l) =>
    exemPatterns.some((re) => re.test(l))
  ).length;
  const exemRatio = exemHits / lines.length;

  // Multiple numbered items + short text → exam-sheet shape.
  if (exemRatio >= 0.15 && exemHits >= 3) return "qa_pairs";

  // Content-title + low numbered-item ratio → definitely content.
  if (titleSaysContent && exemRatio < 0.05) return "content";

  return "unknown";
}

async function classifyChapterType(
  title: string,
  text: string,
  model?: string
): Promise<CardTextType> {
  // Heuristic first — title-based + numbered-item-density. Picks up
  // ~95 % of cases instantly without hitting Gemma at all. Free, fast,
  // and deterministically correct on the obvious chapters that
  // confused the LLM (e.g. "Aufgaben zur Selbstüberprüfung").
  const heur = heuristicClassify(title, text);
  if (heur !== "unknown") {
    console.log(
      `[card-preprocess] classifyChapterType: heuristic decided "${heur}" (skipping LLM)`
    );
    return heur;
  }

  // Heuristic was inconclusive — ask Gemma on a 4 k sample.
  const slice = text.slice(0, 4000);
  const result = await generate({
    prompt: `Klassifiziere folgenden Auszug:\n\n${slice}`,
    system: CLASSIFY_SYSTEM,
    // 64 tokens for "qa_pairs" or "content" plus optional model
    // preamble. We've seen empty 64-token responses on this call —
    // those now fall through to the explicit-default branch below.
    options: { temperature: 0.0, num_predict: 64 },
    model,
  });
  const raw = (result.response ?? "").trim().toLowerCase();
  if (raw.length < 3) {
    console.warn(
      `[card-preprocess] classifyChapterType: LLM returned empty (done_reason=${result.doneReason ?? "?"}) — defaulting to content`
    );
  }
  // "qa" anywhere near the start — tolerates model prefixes like
  // "Antwort: " or markdown quotes.
  if (/\bqa[_ -]?pairs?\b/.test(raw) || raw.startsWith("qa")) return "qa_pairs";
  return "content";
}

// ---------------------------------------------------------------------
// Stage 2a — Q&A extraction
// ---------------------------------------------------------------------

const QA_SYSTEM = `Du extrahierst aus einem Klausur- oder Übungs-Kapiteltext alle Aufgaben und (falls vorhanden) ihre Musterlösungen.

ANTWORT-FORMAT: ausschließlich ein valides JSON-Array, keine Codefences, keine Einleitung. Jedes Element:
{
  "number": "<Aufgaben-Nummer wie im Original, z.B. '3.1', '4.2a' — leer wenn nicht erkennbar>",
  "question": "<Fragetext>",
  "answer": "<Musterlösung wenn vorhanden, sonst leerer String>"
}

REGELN:
- Eine Aufgabe pro Eintrag. Wenn eine Aufgabe Teilaufgaben hat (a, b, c), mache pro Teilaufgabe einen Eintrag.
- Frage-Text als VOLLSTÄNDIGEN selbstständigen Satz formulieren. Beziehe verweise wie "Berechnen Sie nun..." auf, wenn klar woraus.
- Formeln werden aus PDF-Extraktion oft verstümmelt (Subscripts weg, "=" als Leerzeichen, "x 1" statt "x_1"). REKONSTRUIERE sie in LaTeX-Form mit $...$. Beispiel: "P ( x 1  0,5)" → "$P(x_1) = 0,5$".
- Wenn der Musterlösungs-Teil fehlt (Aufgabe ohne Lösung im Heft): answer = "".
- Wenn der Text klar KEINE Aufgaben enthält (Klassifikation war falsch): gib leeres Array [] zurück.

Antwort komplett auf Deutsch.`;

async function extractQaPairs(
  text: string,
  model?: string
): Promise<QaPair[]> {
  const result = await generate({
    prompt: `Extrahiere Aufgaben + Lösungen aus folgendem Text:\n\n${text}`,
    system: QA_SYSTEM,
    model,
    options: {
      temperature: 0.1,
      num_ctx: 32768,
      // 8192 war oft zu knapp — eine grosse Klausur-Aufgaben-Liste
      // mit Mathe-Formeln in LaTeX wird leicht 12k+ Tokens. Zu kurz
      // = Gemma reisst mid-JSON ab, JSON.parse failed, alles im Eimer.
      // 16384 deckt typische Hefte ab.
      num_predict: 16384,
    },
  });
  const raw = (result.response ?? "").trim();
  const json = tryStripJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (parseErr) {
    // Recovery attempt: many LLMs emit a valid JSON array followed by
    // a "Note:" comment or extra prose. Walk forward to find the
    // first `[` and back from the end to find the matching `]`,
    // re-try parsing on that slice.
    const recovered = extractFirstJsonArray(json);
    if (recovered !== null) {
      try {
        parsed = JSON.parse(recovered);
      } catch {
        parsed = null;
      }
    }
    if (parsed === null) {
      const head = raw.slice(0, 200);
      const tail = raw.length > 400 ? raw.slice(-200) : "";
      const cause =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      throw new Error(
        `Q&A extraction returned non-JSON. parse-error: ${cause}. ` +
          `output length=${raw.length}, done_reason=${result.doneReason ?? "?"}. ` +
          `head: ${head}` +
          (tail ? ` ... tail: ${tail}` : "")
      );
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Q&A extraction did not return an array");
  }
  const out: QaPair[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const question =
      typeof obj.question === "string" ? obj.question.trim() : "";
    if (!question) continue;
    out.push({
      question,
      answer:
        typeof obj.answer === "string" ? obj.answer.trim() : "",
      number:
        typeof obj.number === "string" && obj.number.trim().length > 0
          ? obj.number.trim()
          : undefined,
    });
  }
  return out;
}

/** Strip an optional ```json ... ``` fence if the LLM ignored the
 *  "no code fences" instruction. Keeps the JSON-parse robust. */
function tryStripJson(s: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(s.trim());
  if (fence) return fence[1].trim();
  return s.trim();
}

/** Walks the string looking for the first balanced top-level JSON
 *  array. Tolerates trailing prose ("[ ... ]\n\nNote: this is..."),
 *  leading commentary, or unmatched braces inside string literals.
 *  Returns the substring `[...]` on success, or null if we can't
 *  isolate a balanced array. */
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

// ---------------------------------------------------------------------
// Stage 2b — content cleanup (formula reconstruction)
// ---------------------------------------------------------------------

const CONTENT_SYSTEM = `Du bereitest einen Kapiteltext für eine spätere Lernkarten-Generierung auf. Deine ALLEINIGE Aufgabe: mathematische / physikalische / informatische FORMELN im Text rekonstruieren, die aus der PDF-Extraktion verstümmelt sind.

TYPISCHE GARBLE-MUSTER (Beispiele):
- "P ( x 1 ) = 0,5"      ist meist "P(x_1) = 0,5"
- "τ 1  1 ms"             ist meist "τ_1 = 1 ms"
- "P ( x 1  0)  p"        ist meist "P(x_1 = 0) = p"
- "H ( X )  - sum ..."   ist meist "H(X) = -Σ ..."

REGELN:
- Reine TEXT-Stellen (Fließtext, Definitionen ohne Formel) bleiben WORT-WÖRTLICH unverändert.
- Verstümmelte Formel-Stellen ersetzt du durch saubere LaTeX-Form mit $...$ für inline ($P(x_i) = 0{,}5$) oder $$...$$ für Block-Formeln ($$H(X) = -\\sum_{i=1}^n p_i \\log_2 p_i$$).
- Subscripts: x_i, τ_1, p_i — niemals "x 1" oder "tau 1" als getrennte Tokens.
- Komma als Dezimaltrenner mit Schweif-Notation in LaTeX: $0{,}5$ statt $0,5$ (sonst frisst LaTeX den Komma als Listen-Trenner).
- Wenn eine Formel so kaputt ist dass die Rekonstruktion raten wäre: lass die Stelle als verstümmelten Text stehen und füge in eckigen Klammern hinzu "[Formel im Original verstümmelt — bitte im Heft nachschauen]".
- Erfinde KEINE neuen Inhalte, ergänze KEINE Beispiele, kürze NICHTS außer den Garble-Whitespace.

ANTWORT: nur der aufbereitete Text. Keine Einleitung, keine Erklärung, keine Codefences. Markdown-Formatierung bleibt unverändert.`;

async function rewriteContentForCards(
  text: string,
  model?: string
): Promise<string> {
  const result = await generate({
    prompt: `Bereite folgenden Kapiteltext auf:\n\n${text}`,
    system: CONTENT_SYSTEM,
    model,
    options: {
      temperature: 0.1,
      num_ctx: 32768,
      num_predict: 12000,
    },
  });
  const out = (result.response ?? "").trim();
  if (out.length < 20) {
    throw new Error(
      `Content rewrite returned only ${out.length} chars — model=${result.model}`
    );
  }
  return out;
}

// ---------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------

interface ChapterRow {
  id: string;
  text: string;
  card_text: string | null;
  card_text_model: string | null;
  card_text_type: string | null;
  number: number;
  title: string;
}

export async function preprocessChapterForCards(params: {
  chapterId: string;
  /** Optional model override. Otherwise the current provider's
   *  default model is used. */
  model?: string;
  /** Ignore cache and regenerate. */
  force?: boolean;
}): Promise<CardPreprocessResult> {
  const d = db();
  const row = d
    .prepare(
      "SELECT id, text, card_text, card_text_model, card_text_type, number, title FROM chapters WHERE id = ?"
    )
    .get(params.chapterId) as ChapterRow | undefined;
  if (!row) throw new Error(`Chapter ${params.chapterId} not found`);
  if (!row.text || row.text.trim().length < 100) {
    throw new Error("Chapter text too short to preprocess");
  }

  const label = `chapter ${row.number}${row.title ? ` "${row.title.slice(0, 40)}"` : ""}`;

  if (
    !params.force &&
    row.card_text &&
    row.card_text.trim().length > 0 &&
    (row.card_text_type === "qa_pairs" || row.card_text_type === "content")
  ) {
    console.log(
      `[card-preprocess] ${label} cache hit (type=${row.card_text_type}, ${row.card_text.length} chars, model=${row.card_text_model ?? "?"})`
    );
    return {
      type: row.card_text_type as CardTextType,
      text: row.card_text,
      model: row.card_text_model ?? "cached",
      cached: true,
      pairs:
        row.card_text_type === "qa_pairs"
          ? safeParsePairs(row.card_text)
          : undefined,
    };
  }

  if (!(await llmAvailable())) {
    throw new Error("llm_unavailable");
  }

  // Everything below hits Gemma — wrap in the shared lock so we never
  // run two preprocess calls in parallel (neither across card+audio
  // preprocess, nor across multiple chapters from a batch run, nor
  // from rapid clicks in the UI).
  return withGemmaLock(`card ${label}`, async () => {

  const tStart = Date.now();
  console.log(
    `[card-preprocess] ${label} START (${row.text.length} chars source)`
  );

  // Stage 1: detect type
  const type = await classifyChapterType(row.title, row.text, params.model);
  console.log(`[card-preprocess] ${label} classified as "${type}"`);

  // Stage 2: type-specific extraction
  let outText: string;
  let outModel: string;
  let pairs: QaPair[] | undefined;
  if (type === "qa_pairs") {
    // extractQaPairs can throw if Gemma truncates mid-JSON
    // (num_predict cap hit, model glitch, etc.). Catch + log + fall
    // back to content mode so a single bad extraction doesn't kill
    // the whole chapter — the user can still get cleaned text to
    // generate cards from.
    let extracted: QaPair[] = [];
    try {
      extracted = await extractQaPairs(row.text, params.model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[card-preprocess] ${label} qa_pairs extraction threw — falling back to content mode. Cause: ${msg.slice(0, 300)}`
      );
    }
    if (extracted.length === 0) {
      // Classifier said qa_pairs but extraction found nothing OR
      // threw — fall back to content mode so the chapter isn't useless.
      const cleaned = await rewriteContentForCards(row.text, params.model);
      outText = cleaned;
      outModel = (await getActiveModelName(params.model)) ?? "unknown";
      pairs = undefined;
      d.prepare(
        "UPDATE chapters SET card_text = ?, card_text_model = ?, card_text_type = 'content' WHERE id = ?"
      ).run(outText, outModel, params.chapterId);
      const totalS = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(
        `[card-preprocess] ${label} DONE in ${totalS}s (fallback content mode, ${outText.length} chars)`
      );
      return { type: "content", text: outText, model: outModel, cached: false };
    }
    outText = JSON.stringify(extracted, null, 2);
    outModel = (await getActiveModelName(params.model)) ?? "unknown";
    pairs = extracted;
    d.prepare(
      "UPDATE chapters SET card_text = ?, card_text_model = ?, card_text_type = 'qa_pairs' WHERE id = ?"
    ).run(outText, outModel, params.chapterId);
    const totalS = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(
      `[card-preprocess] ${label} DONE in ${totalS}s (${extracted.length} Q&A pairs)`
    );
    return { type: "qa_pairs", text: outText, model: outModel, cached: false, pairs };
  }

  // content mode
  const cleaned = await rewriteContentForCards(row.text, params.model);
  outText = cleaned;
  outModel = (await getActiveModelName(params.model)) ?? "unknown";
  d.prepare(
    "UPDATE chapters SET card_text = ?, card_text_model = ?, card_text_type = 'content' WHERE id = ?"
  ).run(outText, outModel, params.chapterId);
  const totalS = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(
    `[card-preprocess] ${label} DONE in ${totalS}s (content mode, ${outText.length} chars)`
  );
  return { type: "content", text: outText, model: outModel, cached: false };
  }); // withGemmaLock
}

function safeParsePairs(json: string): QaPair[] | undefined {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(
      (p): p is QaPair =>
        p && typeof p === "object" && typeof p.question === "string"
    );
  } catch {
    return undefined;
  }
}

/** Returns the resolved model name as reported by the most recent
 *  generate() call. We re-resolve here by doing a minimal probe —
 *  but cheaper: just return the requested model if any, otherwise
 *  read from the active provider. */
async function getActiveModelName(model?: string): Promise<string | null> {
  if (model && model.trim().length > 0) return model.trim();
  // Quick generate-call to retrieve the resolved default model. We
  // could hit /api/tags directly but that's another util; this
  // single-token roundtrip costs almost nothing and gives us the
  // canonical name as the provider sees it.
  try {
    const probe = await generate({
      prompt: "ok",
      system: "Antworte mit 'ok'.",
      options: { temperature: 0.0, num_predict: 2 },
    });
    return probe.model || null;
  } catch {
    return null;
  }
}

/** Re-imports cached qa_pairs into the cards table. Used by the
 *  cards route when card_text_type === "qa_pairs". Returns the number
 *  of new cards inserted (skips duplicates by question text within
 *  the same chapter). */
export function importQaPairsAsCards(params: {
  chapterId: string;
  documentId: string;
  startPage: number | null;
  difficulty?: "easy" | "medium" | "hard";
}): { inserted: number; skipped: number; pairs: number } {
  const d = db();
  const row = d
    .prepare(
      "SELECT card_text, card_text_type FROM chapters WHERE id = ?"
    )
    .get(params.chapterId) as
    | { card_text: string | null; card_text_type: string | null }
    | undefined;
  if (!row || row.card_text_type !== "qa_pairs" || !row.card_text) {
    return { inserted: 0, skipped: 0, pairs: 0 };
  }
  const pairs = safeParsePairs(row.card_text) ?? [];
  if (pairs.length === 0) return { inserted: 0, skipped: 0, pairs: 0 };

  const existing = d
    .prepare(
      "SELECT question FROM cards WHERE chapter_id = ?"
    )
    .all(params.chapterId) as Array<{ question: string }>;
  const seen = new Set(existing.map((r) => normalizeForDedupe(r.question)));

  const insert = d.prepare(
    "INSERT INTO cards (id, document_id, chapter_id, question, answer, difficulty, source_page, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'qa_imported')"
  );
  let inserted = 0;
  let skipped = 0;
  const tx = d.transaction(() => {
    for (const p of pairs) {
      const norm = normalizeForDedupe(p.question);
      if (seen.has(norm)) {
        skipped++;
        continue;
      }
      insert.run(
        randomUUID(),
        params.documentId,
        params.chapterId,
        p.question,
        p.answer,
        params.difficulty ?? "medium",
        params.startPage
      );
      seen.add(norm);
      inserted++;
    }
  });
  tx();
  return { inserted, skipped, pairs: pairs.length };
}

function normalizeForDedupe(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
