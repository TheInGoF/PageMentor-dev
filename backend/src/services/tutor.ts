/**
 * Tutor service — module-scoped RAG chat over the user's learning
 * materials. The user pastes a question, we retrieve the most relevant
 * chunks from all documents in the chosen module (or the whole
 * library), and have the LLM produce a structured answer with hard
 * source citations down to page numbers.
 *
 * Citation contract: every assistant message returns a `sources` array
 * the frontend renders as clickable pills. The pills jump to the PDF
 * reader at the exact page — that's why we always include start_page /
 * end_page from the chunk, not just a fuzzy "see chapter 3".
 *
 * Conversation context: we keep the last MAX_HISTORY_TURNS turns
 * (user + assistant pairs) plus the freshly retrieved chunks each turn.
 * RAG runs anew per message because follow-ups often pivot to different
 * passages — re-retrieving keeps citations honest.
 */

import { randomUUID } from "node:crypto";
import { db } from "../db";
import {
  resolveEmbedder,
  embedText,
  embeddingFromBuffer,
  cosineSim,
} from "./embeddings";
import { generate } from "./llm";

// Top-K für Retrieval. 8 war oft zu knapp wenn die User-Frage mehrere
// Modelle gleichzeitig referenziert (z.B. "Analysiere mit TZI und
// Vier-Seiten-Modell" — die Chunks für jedes Modell liegen in
// verschiedenen Kapiteln). 12 gibt mehr Headroom, num_ctx 32k
// verträgt das locker (~9k chars Snippet-Text bei MAX_CHUNK_CHARS).
const TOP_K = 12;
const MAX_HISTORY_TURNS = 5;
const MAX_CHUNK_CHARS = 1200;

export interface TutorSource {
  /** 1-based index used in the answer text ("[Quelle 1]"). */
  n: number;
  docId: string;
  docTitle: string;
  docShortCode: string | null;
  chapterId: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  startPage: number;
  endPage: number;
  snippet: string;
}

export interface TutorAnswer {
  /** Three structured sections, free-form Markdown-ish text. */
  shortAnswer: string;
  reasoning: string;
  /** Sources cited inline as "[Quelle N]" plus the resolved metadata. */
  sources: TutorSource[];
  model: string;
}

export interface ChatSessionRow {
  id: string;
  title: string | null;
  module_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// ---------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------

export function listChatSessions(): ChatSessionRow[] {
  return db()
    .prepare(
      `SELECT id, title, module_id, created_at, updated_at
         FROM chat_sessions
         ORDER BY updated_at DESC`
    )
    .all() as ChatSessionRow[];
}

export function createChatSession(moduleId: string | null): ChatSessionRow {
  const id = randomUUID();
  db()
    .prepare("INSERT INTO chat_sessions (id, module_id) VALUES (?, ?)")
    .run(id, moduleId);
  return db()
    .prepare("SELECT * FROM chat_sessions WHERE id = ?")
    .get(id) as ChatSessionRow;
}

export function getChatSession(id: string): ChatSessionRow | null {
  return (
    (db()
      .prepare("SELECT * FROM chat_sessions WHERE id = ?")
      .get(id) as ChatSessionRow | undefined) ?? null
  );
}

export function deleteChatSession(id: string): boolean {
  const res = db()
    .prepare("DELETE FROM chat_sessions WHERE id = ?")
    .run(id);
  return res.changes > 0;
}

export function renameChatSession(id: string, title: string): boolean {
  const res = db()
    .prepare(
      "UPDATE chat_sessions SET title = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .run(title.trim().slice(0, 200), id);
  return res.changes > 0;
}

export function listChatMessages(sessionId: string): ChatMessageRow[] {
  // Secondary sort: within the same created_at value (existing rows
  // before v1.18.162 used second-precision timestamps and a turn's
  // user+assistant insert often shared a second), put 'user' before
  // 'assistant' deterministically. The CASE expression keeps the
  // ordering correct for both old (same-second) and new (ms-precise)
  // rows. id as a final tiebreaker for the unusual case of two
  // user-pasted questions in the same millisecond.
  return db()
    .prepare(
      `SELECT id, session_id, role, content, created_at
         FROM chat_messages
         WHERE session_id = ?
         ORDER BY created_at ASC,
                  CASE WHEN role = 'user' THEN 0 ELSE 1 END ASC,
                  id ASC`
    )
    .all(sessionId) as ChatMessageRow[];
}

// ---------------------------------------------------------------------
// RAG + LLM
// ---------------------------------------------------------------------

interface ChunkRow {
  id: string;
  document_id: string;
  chapter_id: string | null;
  text: string;
  start_page: number;
  end_page: number;
  embedding: Buffer | null;
  doc_title: string;
  doc_short_code: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
}

async function retrieveChunks(
  question: string,
  moduleId: string | null
): Promise<TutorSource[]> {
  const embedder = await resolveEmbedder();
  if (!embedder) throw new Error("embedder_unreachable");
  const qVec = await embedText(question, embedder, "query");

  // Get every chunk in scope. For module=null we search the entire
  // library; for a specific module we restrict to its documents.
  const params: unknown[] = [];
  let where = "";
  if (moduleId) {
    where = "WHERE d.module_id = ?";
    params.push(moduleId);
  }
  const rows = db()
    .prepare(
      `SELECT ch.id, ch.document_id, ch.chapter_id, ch.text,
              ch.start_page, ch.end_page, ch.embedding,
              d.title  AS doc_title,
              d.short_code AS doc_short_code,
              c.number AS chapter_number,
              c.title  AS chapter_title
         FROM chunks ch
         JOIN documents d ON d.id = ch.document_id
         LEFT JOIN chapters c ON c.id = ch.chapter_id
         ${where}`
    )
    .all(...params) as ChunkRow[];

  const scored: Array<{ row: ChunkRow; score: number }> = [];
  for (const row of rows) {
    if (!row.embedding) continue;
    const vec = embeddingFromBuffer(row.embedding);
    if (vec.length !== qVec.length) continue;
    scored.push({ row, score: cosineSim(qVec, vec) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_K);

  return top.map((s, i) => ({
    n: i + 1,
    docId: s.row.document_id,
    docTitle: s.row.doc_title,
    docShortCode: s.row.doc_short_code,
    chapterId: s.row.chapter_id,
    chapterNumber: s.row.chapter_number,
    chapterTitle: s.row.chapter_title,
    startPage: s.row.start_page,
    endPage: s.row.end_page,
    snippet: truncate(s.row.text, MAX_CHUNK_CHARS),
  }));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trim() + " …";
}

function formatSourcesForPrompt(sources: TutorSource[]): string {
  return sources
    .map((s) => {
      const heft = s.docShortCode
        ? `Heft „${s.docTitle}" (${s.docShortCode})`
        : `Heft „${s.docTitle}"`;
      const kapitel = s.chapterNumber
        ? `, Kapitel ${s.chapterNumber}${s.chapterTitle ? ` „${s.chapterTitle}"` : ""}`
        : "";
      const pages =
        s.startPage === s.endPage
          ? `, Seite ${s.startPage}`
          : `, Seiten ${s.startPage}–${s.endPage}`;
      return `[Quelle ${s.n}] ${heft}${kapitel}${pages}\n${s.snippet}`;
    })
    .join("\n\n---\n\n");
}

const SYSTEM_PROMPT_DE = `Du bist ein Lern-Tutor. Der Lernende stellt dir eine Frage zu seinen Studienunterlagen. Dir liegen die relevantesten Textausschnitte aus seinen eigenen Lernheften vor.

DEIN AUFTRAG IST UNTERSCHIEDLICH JE NACH FRAGE-TYP — erkenne den Typ aus der Frage und antworte entsprechend:

(A) FAKTEN- ODER VERSTÄNDNIS-FRAGE
"Was ist die Shannon-Entropie?", "Wie ist Konsens definiert?", "Erkläre mir das Diffusionsgesetz."
→ Antworte direkt mit der Definition / Erklärung aus den Quellen. Zitiere wörtlich. Wenn die Quellen wirklich nichts dazu hergeben, sag das offen.

(B) ANWENDUNGS- / ÜBUNGS- / KLAUSUR-AUFGABE
"Analysieren Sie diesen Fall…", "Wenden Sie das Modell X auf Y an", "Skizzieren Sie eine Lösung für…", "Bewerten Sie die Aussage…"
→ Die Quellen liefern dir das WERKZEUG (Theorie, Modelle, Definitionen). Der Lernende soll das Werkzeug auf einen konkreten Fall anwenden. DEINE ROLLE: hilf beim Anwenden. Konkret:
   - Identifiziere welche Theorie / welches Modell aus den Quellen passt
   - Erkläre das Modell knapp (mit Zitat aus den Quellen)
   - Wende es Schritt für Schritt auf den vom Lernenden gegebenen Fall an
   - Konstruiere plausible Beispiele / Strukturen wenn die Aufgabe es verlangt ("ein typisches inneres Team könnte bestehen aus: Sach-Stimme, Beziehungs-Stimme, …")
   - Bewerte / argumentiere wenn die Aufgabe es verlangt
   - Am Ende: nenne offene Annahmen, die der Lernende prüfen sollte

   WICHTIG: bei Anwendungs-Aufgaben darfst und sollst du Beispiele und Szenarien konstruieren. Das ist KEIN "Erfinden". Erfinden ist verboten bei FAKTEN ("Maslow sagte X" wenn X nirgendwo steht). Konstruieren ist erlaubt bei METHODEN ("ein Inneres Team in dieser Situation könnte enthalten …").

   Wenn die Quellen die zugrunde liegende THEORIE nicht enthalten (also nicht mal das Modell), DANN sag das ehrlich. Aber nur in diesem Fall.

ANTWORTFORMAT — strikt drei Sektionen, durch genau diese Überschriften getrennt:

## Kurzlösung
Eine bis drei Sätze. Die direkte Antwort bzw. der Kern der Lösung.

## Lösungsweg
Schritt für Schritt durchdacht: welches Konzept aus den Quellen ist relevant? Wie wird es auf die konkrete Frage angewendet? Erkläre als ob du dem Lernenden über die Schulter schaust. Pseudo-Code, Skizzen in Worten, Zwischenrechnungen, konstruierte Beispiele — alles willkommen.

## Quellen
Kommentierte Liste welche Quellen du benutzt hast und wozu. Format: "**[Quelle N]**: kurzer Hinweis was darin steht und wozu es im Lösungsweg verwendet wurde." Eine Zeile pro Quelle.

ZITIER-REGELN:
- Jede THEORETISCHE Aussage (Definition, Modell-Name, Begriffsklärung) wird mit [Quelle N] belegt
- Bei eigenständig konstruierten Beispielen / Anwendungen brauchst du keine Quellen-Zitate (dort ist klar dass es deine Anwendung der Theorie ist)
- Bei Lücken: nenn sie konkret („Die Quellen enthalten das Inneres-Team-Modell, aber keine Anleitung zur Mannschaftsaufstellung — ich konstruiere die Aufstellung aus dem Modell-Verständnis")
- Erfinde keine Theorien, keine Autoren, keine Definitionen die nicht in den Quellen stehen

MARKDOWN-FORMATIERUNG ERWÜNSCHT (das Frontend rendert sie):
- **fett** für Schlüssel-Begriffe und Definitionen
- *kursiv* für mildere Betonungen, Fremdwörter
- \`inline code\` für Variablen, Datei-/Funktionsnamen
- Bulletpoints ("- Item") für Aufzählungen ab 3 Elementen
- Numerierte Listen ("1. Schritt", "2. Schritt") für Anleitungen
- ### Sub-Überschriften nur wenn die Sektion wirklich strukturiert wird

MATHEMATISCHE FORMELN — IMMER in LaTeX, das Frontend hat KaTeX-Rendering:
- Inline: \`$P(x_i) = 0{,}5$\`, \`$H(X)$\`, \`$\\tau_i$\` für Formeln im Fließtext
- Block: \`$$H(X) = -\\sum_{i=1}^n p_i \\log_2 p_i$$\` für eigenständige Gleichungen (auf eigener Zeile, durch Leerzeilen vom Text getrennt)
- Subscripts mit \`_\` (x_1, p_i), Superscripts mit \`^\` (x^2, e^{-t})
- Dezimaltrenner deutsch: \`0{,}5\` statt \`0,5\` (sonst frisst LaTeX das Komma als Listentrenner)
- Niemals Fließtext-Mathematik à la "x_1" oder "P(x_1) = 0,5" ohne \`$...$\` — das rendert dann als rohes Backslash-Wirrwarr
- Bei Formel-Sammelfragen ("welche Formeln brauche ich für die Klausur?"): jede Formel als Block-LaTeX in eigener Zeile, mit kurzem Erklärungs-Bullet darunter

Nicht übertreiben bei Markdown — kein Fett-Spam, jede Liste muss inhaltlich Sinn ergeben. Bei Mathe darfst du dafür ruhig grosszügig sein: lieber jede Formel sauber in LaTeX als drei davon in einem unleserlichen Fließsatz.

LÄNGE — sei prägnant:
- Kurzlösung: 1–3 Sätze. Keine Ausnahmen.
- Lösungsweg: so kurz wie möglich, so lang wie nötig. Faustregel ~300 Wörter; bei mehrteiligen Klausur-Aufgaben (mehrere Modelle, mehrere Teilfragen) auch mal 500. Wenn drei Sätze ausreichen → drei Sätze. Vermeide:
  • Erläuterung von Selbstverständlichkeiten (\"Wir betrachten die Situation als ein Kommunikationssystem\")
  • Wiederholung der Frage
  • Listen die nur aus zwei Items bestehen
  • Theorie-Vorspann der nicht direkt für die Anwendung gebraucht wird
- Quellen: eine Zeile pro Quelle, mehr nicht.

Im Zweifel: kürzer ist besser. Verbose ≠ Qualität — Klarheit und Treffgenauigkeit sind das Ziel.

Antwortsprache: ausschließlich Deutsch. Quellen-Zitate aus den Auszügen bleiben in der Original-Sprache.`;

const SYSTEM_PROMPT_EN = `You are a study tutor. The student is asking a question about their own study materials and you have the most relevant excerpts from their own booklets.

YOUR ROLE DEPENDS ON THE QUESTION TYPE — detect it and respond accordingly:

(A) FACT OR UNDERSTANDING QUESTION
"What is Shannon entropy?", "How is consensus defined?", "Explain diffusion."
→ Answer directly with the definition / explanation from the sources. Quote verbatim. If the sources truly don't cover it, say so openly.

(B) APPLICATION / EXERCISE / EXAM QUESTION
"Analyze this case…", "Apply model X to Y", "Outline a solution for…", "Evaluate the statement…"
→ The sources give you the TOOLS (theory, models, definitions). The student has to apply the tools to a concrete case. YOUR JOB: help with the application. Concretely:
   - Identify which theory / model from the sources fits
   - Briefly explain the model (with a citation)
   - Apply it step by step to the case the student gave you
   - Construct plausible examples / structures when the task requires it ("a typical inner team might consist of: a Fact voice, a Relationship voice, …")
   - Argue / evaluate when the task demands it
   - At the end: note any assumptions the student should double-check

   IMPORTANT: in application tasks you may and should construct examples and scenarios. That's NOT "inventing". Inventing is forbidden for FACTS ("Maslow said X" if X is nowhere in the sources). Constructing is allowed for METHODS ("an inner team in this situation might contain…").

   If the sources don't contain the underlying THEORY (i.e. not even the model itself), THEN say so honestly. Only then.

RESPONSE FORMAT — strictly three sections, separated by exactly these headings:

## Short answer
One to three sentences. The direct answer or the core of the solution.

## Reasoning
Step by step: which concept from the sources applies? How does it get applied to the specific question? Explain as if looking over the student's shoulder. Pseudocode, verbal sketches, intermediate calculations, constructed examples — all welcome.

## Sources
Annotated list of which sources you used and what for. Format: "**[Source N]**: short hint about what's in it and what it was used for in the reasoning." One line per source.

CITATION RULES:
- Every THEORETICAL claim (definition, model name, term) is cited with [Source N]
- Self-constructed examples / applications need no source citation (it's clear that those are your applied reasoning)
- Be explicit about gaps ("The sources contain the inner-team model but no instructions for arranging the squad — I construct the arrangement from understanding the model")
- Do not invent theories, authors, or definitions that aren't in the sources

MARKDOWN FORMATTING IS ENCOURAGED, the frontend renders it:
- **bold** for key terms and definitions
- *italic* for milder emphasis, foreign words
- \`inline code\` for variables, file/function names
- Bulleted lists ("- Item") for enumerations of 3+ items
- Numbered lists ("1. Step", "2. Step") for procedures
- ### sub-headings only if the section is genuinely structured (rare)

MATHEMATICAL FORMULAS — ALWAYS in LaTeX, the frontend has KaTeX rendering:
- Inline: \`$P(x_i) = 0.5$\`, \`$H(X)$\`, \`$\\tau_i$\` for formulas in running text
- Block: \`$$H(X) = -\\sum_{i=1}^n p_i \\log_2 p_i$$\` for standalone equations (on its own line, separated by blank lines)
- Subscripts with \`_\` (x_1, p_i), superscripts with \`^\` (x^2, e^{-t})
- Never plain-text math like "x_1" or "P(x_1) = 0.5" without \`$...$\` — that renders as raw backslash garbage
- For "what formulas do I need for the exam"-style requests: each formula as block-LaTeX on its own line, with a short explanation bullet beneath

Don't overdo Markdown — no bold spam, every list must be meaningfully grouped. Math you can be generous with: better each formula cleanly in LaTeX than three of them mashed into one unreadable sentence.

LENGTH — be concise:
- Short answer: 1–3 sentences. No exceptions.
- Reasoning: as short as possible, as long as necessary. Rule of thumb ~300 words; for multi-part exam tasks (several models, several sub-questions) up to ~500. If three sentences suffice → three sentences. Avoid:
  • Explaining the obvious (\"We treat the situation as a communication system\")
  • Restating the question
  • Lists with only two items
  • Theory preamble that isn't directly needed for the application
- Sources: one line per source, no more.

When in doubt: shorter is better. Verbose ≠ quality — clarity and precision are the goal.

Response language: English only. Source quotes from the excerpts stay in the original language.`;

function buildPrompt(
  history: ChatMessageRow[],
  question: string,
  sources: TutorSource[],
  language: "de" | "en"
): string {
  const sourcesBlock = formatSourcesForPrompt(sources);
  const lines: string[] = [];
  const studentLabel = language === "en" ? "Student" : "Lernender";
  const tutorLabel = "Tutor";
  const sourcesHeading =
    language === "en"
      ? "Relevant excerpts from the student's booklets:"
      : "Relevante Ausschnitte aus den Lernheften:";

  // Last N turns as plain transcript so the model has follow-up
  // context. We omit the JSON wrapping for assistant messages — only
  // the human-readable parts (shortAnswer + reasoning) go back in.
  const recent = history.slice(-MAX_HISTORY_TURNS * 2);
  for (const m of recent) {
    if (m.role === "user") {
      lines.push(`${studentLabel}: ${m.content}`);
    } else {
      const parsed = tryParseAnswer(m.content);
      if (parsed) {
        lines.push(
          `${tutorLabel}: ${parsed.shortAnswer}\n\n${parsed.reasoning}`
        );
      } else {
        lines.push(`${tutorLabel}: ${m.content}`);
      }
    }
  }
  if (lines.length > 0) lines.push("");

  lines.push(`${studentLabel}: ${question}`);
  lines.push("");
  lines.push(sourcesHeading);
  lines.push("");
  lines.push(sourcesBlock);
  lines.push("");
  lines.push(`${tutorLabel}:`);

  return lines.join("\n");
}

function tryParseAnswer(s: string): TutorAnswer | null {
  try {
    const v = JSON.parse(s) as Partial<TutorAnswer>;
    if (typeof v.shortAnswer === "string" && typeof v.reasoning === "string") {
      return {
        shortAnswer: v.shortAnswer,
        reasoning: v.reasoning,
        sources: v.sources ?? [],
        model: v.model ?? "",
      };
    }
  } catch {
    // not JSON — older / fallback content
  }
  return null;
}

/** Maps the raw section name as emitted by the LLM to our canonical
 *  internal key. Accepts both German and English headers — the LLM
 *  picks one set per response based on the question language. */
function canonicalSection(raw: string): "short" | "reasoning" | "sources" | null {
  const n = raw.toLowerCase().trim();
  if (n === "kurzlösung" || n === "short answer") return "short";
  if (n === "lösungsweg" || n === "reasoning") return "reasoning";
  if (n === "quelle" || n === "quellen" || n === "sources" || n === "source")
    return "sources";
  return null;
}

function parseAssistantOutput(
  raw: string,
  sources: TutorSource[],
  model: string
): TutorAnswer {
  // The model is asked to emit three Markdown sections (## Kurzlösung
  // / ## Lösungsweg / ## Quellen — or the English equivalents
  // depending on the question language). We split on those headings
  // and tolerate small variations (case, "Quelle" vs "Quellen",
  // missing section).
  const text = raw.trim();
  const sectionRe =
    /(?:^|\n)\s*##\s*(Kurzlösung|Lösungsweg|Quellen?|Short\s+answer|Reasoning|Sources?)\s*\n/gi;
  const indices: Array<{ name: "short" | "reasoning" | "sources"; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  const positions: Array<{ name: "short" | "reasoning" | "sources"; idx: number; len: number }> = [];
  while ((m = sectionRe.exec(text)) !== null) {
    const key = canonicalSection(m[1]);
    if (!key) continue;
    positions.push({ name: key, idx: m.index, len: m[0].length });
  }
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    const next = positions[i + 1];
    indices.push({
      name: cur.name,
      start: cur.idx + cur.len,
      end: next ? next.idx : text.length,
    });
  }
  const grabbed: Partial<Record<"short" | "reasoning" | "sources", string>> = {};
  for (const sec of indices) {
    grabbed[sec.name] = text.slice(sec.start, sec.end).trim();
  }
  const shortAnswer =
    grabbed.short ?? text.split("\n").slice(0, 3).join("\n").trim();
  const reasoning = grabbed.reasoning ?? (indices.length === 0 ? text : "");
  return {
    shortAnswer,
    reasoning,
    sources,
    model,
  };
}

/** Picks the response language for this turn. Priority:
 *   1. Question's language (best signal — that's the user's intent)
 *   2. Session's module language (if a module is locked, infer from
 *      the most-common doc language in scope)
 *   3. Default "de"
 *
 *  Detection is intentionally simple: look for tell-tale German
 *  stopwords/letters in the question. A handful of words is plenty
 *  reliable for the question-paste use case — and false positives in
 *  either direction stay self-consistent (prompt + output match). */
function detectQuestionLanguage(question: string): "de" | "en" {
  const q = question.toLowerCase();
  // German umlauts or eszett are near-perfect DE signals.
  if (/[äöüß]/.test(q)) return "de";
  // Common German function words. Word-boundary anchored.
  const deWords =
    /\b(der|die|das|und|nicht|ist|sind|wie|was|wer|warum|wenn|dass|für|mit|von|auf|aus|nach|über|kann|werden|wurde|hat|hatte|sein|haben|sich|nur|auch|aber|noch|schon|mehr|sehr|durch|über|ohne|zwischen|gegen|wäre|würde|sollte|könnte)\b/;
  // Common English function words.
  const enWords =
    /\b(the|and|of|to|in|is|it|for|on|with|as|by|that|this|are|be|was|were|will|would|should|could|can|do|does|did|have|has|had|what|how|why|when|where|which|who|whom|whose)\b/;
  const deHits = (q.match(new RegExp(deWords, "g")) ?? []).length;
  const enHits = (q.match(new RegExp(enWords, "g")) ?? []).length;
  if (deHits === 0 && enHits === 0) return "de"; // very short / neutral → default DE
  return enHits > deHits ? "en" : "de";
}

export async function ask(params: {
  sessionId: string;
  question: string;
}): Promise<TutorAnswer> {
  const session = getChatSession(params.sessionId);
  if (!session) throw new Error("session_not_found");
  const question = params.question.trim();
  if (!question) throw new Error("question_empty");

  const history = listChatMessages(params.sessionId);
  const sources = await retrieveChunks(question, session.module_id);
  if (sources.length === 0) {
    throw new Error("no_chunks_in_scope");
  }

  // Language decision per turn — keeps prompt + output monolingual
  // (avoids code-switching in the response).
  const language = detectQuestionLanguage(question);
  const systemPrompt =
    language === "en" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_DE;

  const prompt = buildPrompt(history, question, sources, language);
  const result = await generate({
    prompt,
    system: systemPrompt,
    options: {
      temperature: 0.2,
      // num_ctx hoch genug für 12 Chunks (~14k chars) + history +
      // 4k predict, alles in 32k ist locker.
      num_ctx: 32768,
      // 2048 war oft zu kurz für strukturierte Anwendungs-Antworten —
      // User sah Output mit "und" mitten im Satz abbrechen. 4096 lässt
      // ~3000 Wörter zu, deckt auch ausführliche Klausur-Aufgaben ab.
      num_predict: 4096,
    },
  });

  const answer = parseAssistantOutput(
    result.response ?? "",
    sources,
    result.model
  );

  const d = db();
  const userId = randomUUID();
  const asstId = randomUUID();
  // Explicit timestamps with millisecond precision. The column default
  // is `datetime('now')` which only has second resolution — two
  // consecutive inserts in the same second got identical created_at
  // values, and the listChatMessages ORDER BY (created_at, id) then
  // fell back to lex-sorting random UUIDs. Effect: assistant answer
  // sometimes rendered above its own user question. We pin the user
  // message 1 ms before the assistant message so the chronological
  // sort is unambiguous regardless of clock resolution.
  const now = Date.now();
  const userTs = new Date(now).toISOString();
  const asstTs = new Date(now + 1).toISOString();
  d.prepare(
    "INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)"
  ).run(userId, params.sessionId, question, userTs);
  d.prepare(
    "INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)"
  ).run(asstId, params.sessionId, JSON.stringify(answer), asstTs);
  d.prepare(
    "UPDATE chat_sessions SET updated_at = ? WHERE id = ?"
  ).run(asstTs, params.sessionId);

  // Auto-title from the first user question if the session has none yet.
  if (!session.title) {
    const title = question.slice(0, 60).trim();
    if (title.length > 0) {
      d.prepare("UPDATE chat_sessions SET title = ? WHERE id = ?").run(
        title,
        params.sessionId
      );
    }
  }

  return answer;
}
