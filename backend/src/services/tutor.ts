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

const TOP_K = 8;
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
  return db()
    .prepare(
      `SELECT id, session_id, role, content, created_at
         FROM chat_messages
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC`
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

const SYSTEM_PROMPT = `Du bist ein Lern-Tutor. Der Lernende stellt dir eine Frage zu seinen Studienunterlagen. Dir liegen die relevantesten Textausschnitte aus seinen eigenen Lernheften vor. Deine Aufgabe: die Frage gründlich beantworten UND erklären wie der Lernende selbst auf die Antwort gekommen wäre.

ANTWORTFORMAT — strikt drei Sektionen, durch genau diese Trennlinien getrennt:

## Kurzlösung
Eine bis drei Sätze. Die direkte Antwort, ohne Drumherum.

## Lösungsweg
Schritt für Schritt: wie kommt man darauf? Welche Konzepte aus dem Heft sind relevant? Wo greift welche Definition? Erkläre als ob du dem Lernenden über die Schulter schaust — Pseudocode, Skizzen in Worten, Zwischenrechnungen sind willkommen.

## Quellen
Kommentierte Liste welche Quellen du benutzt hast und wozu sie dienen. Format: "**[Quelle N]**: kurzer Hinweis was darin steht und warum es relevant ist." Eine Zeile pro Quelle.

ZITIER-PFLICHT: jede inhaltliche Aussage im "Lösungsweg" wird mit [Quelle N] belegt — direkt im Fließtext, in eckigen Klammern. Wenn dir die Quellen keine Antwort hergeben, sag das ehrlich ("Die vorliegenden Auszüge enthalten dazu keine ausreichenden Hinweise") und benenne, was zur Beantwortung fehlt — erfinde NICHTS dazu.

Antwortsprache: Deutsch.`;

function buildPrompt(
  history: ChatMessageRow[],
  question: string,
  sources: TutorSource[]
): string {
  const sourcesBlock = formatSourcesForPrompt(sources);
  const lines: string[] = [];

  // Last N turns as plain transcript so the model has follow-up
  // context. We omit the JSON wrapping for assistant messages — only
  // the human-readable parts (shortAnswer + reasoning) go back in.
  const recent = history.slice(-MAX_HISTORY_TURNS * 2);
  for (const m of recent) {
    if (m.role === "user") {
      lines.push(`Lernender: ${m.content}`);
    } else {
      const parsed = tryParseAnswer(m.content);
      if (parsed) {
        lines.push(
          `Tutor: ${parsed.shortAnswer}\n\n${parsed.reasoning}`
        );
      } else {
        lines.push(`Tutor: ${m.content}`);
      }
    }
  }
  if (lines.length > 0) lines.push("");

  lines.push(`Lernender: ${question}`);
  lines.push("");
  lines.push("Relevante Ausschnitte aus den Lernheften:");
  lines.push("");
  lines.push(sourcesBlock);
  lines.push("");
  lines.push("Tutor:");

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

function parseAssistantOutput(
  raw: string,
  sources: TutorSource[],
  model: string
): TutorAnswer {
  // The model is asked to emit three Markdown sections (## Kurzlösung,
  // ## Lösungsweg, ## Quellen). We split on those headings and tolerate
  // small variations (case, "Quelle" vs "Quellen", missing section).
  const text = raw.trim();
  const sectionRe = /(?:^|\n)\s*##\s*(Kurzlösung|Lösungsweg|Quellen?)\s*\n/gi;
  const indices: Array<{ name: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  const positions: Array<{ name: string; idx: number; len: number }> = [];
  while ((m = sectionRe.exec(text)) !== null) {
    positions.push({ name: m[1].toLowerCase(), idx: m.index, len: m[0].length });
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
  const grabbed: Record<string, string> = {};
  for (const sec of indices) {
    grabbed[sec.name] = text.slice(sec.start, sec.end).trim();
  }
  const shortAnswer =
    grabbed["kurzlösung"] ??
    text.split("\n").slice(0, 3).join("\n").trim();
  const reasoning =
    grabbed["lösungsweg"] ??
    (indices.length === 0 ? text : "");
  return {
    shortAnswer,
    reasoning,
    sources,
    model,
  };
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

  const prompt = buildPrompt(history, question, sources);
  const result = await generate({
    prompt,
    system: SYSTEM_PROMPT,
    options: {
      temperature: 0.2,
      num_ctx: 32768,
      num_predict: 2048,
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
  d.prepare(
    "INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, 'user', ?)"
  ).run(userId, params.sessionId, question);
  d.prepare(
    "INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, 'assistant', ?)"
  ).run(asstId, params.sessionId, JSON.stringify(answer));
  d.prepare(
    "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?"
  ).run(params.sessionId);

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
