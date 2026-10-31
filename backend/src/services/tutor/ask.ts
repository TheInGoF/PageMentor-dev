// Tutor: Frage → passende Stellen → strukturierte Antwort mit Quellen
// Quellen mit Seitenzahl, Klick öffnet das PDF an der Stelle
// Suche läuft pro Nachricht neu: Nachfragen springen oft woanders hin
import { randomUUID } from "node:crypto";
import { db } from "../../db";
import { generate } from "../llm";
import { cleanupHints } from "../promptHints";
import { getPrompt } from "../prompts";
import { MAX_HISTORY_TURNS, type ChatMessageRow, type TutorAnswer, type TutorSource } from "./types";
import { getChatSession, listChatMessages } from "./sessions";
import { retrieveChunks, formatSourcesForPrompt } from "./retrieve";
import { materialSources, retrieveMaterial } from "./material";
import { runJob } from "../../log/jobs";


function buildPrompt(
  history: ChatMessageRow[],
  question: string,
  sources: TutorSource[],
  language: "de" | "en",
  conceptNet = ""
): string {
  const sourcesBlock = formatSourcesForPrompt(sources);
  const lines: string[] = [];
  const studentLabel = language === "en" ? "Student" : "Lernender";
  const tutorLabel = "Tutor";
  const sourcesHeading =
    language === "en"
      ? "Relevant excerpts from the student's booklets:"
      : "Relevante Ausschnitte aus den Lernheften:";

  // Letzte Runden als Klartext, Antworten ohne JSON-Hülle
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
  // Begriffsnetz: welche Grundlagen die gefragten Begriffe brauchen, zum Herleiten von unten
  if (conceptNet) {
    lines.push(language === "en" ? "Concept network (prerequisites up to three levels):" : "Begriffsnetz (Voraussetzungen bis drei Ebenen):");
    lines.push(conceptNet);
    lines.push("");
  }
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
    // Kein JSON: ältere Inhalte
  }
  return null;
}

// LLM-Abschnittsname → interner Schlüssel, deutsch oder englisch
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
  // Drei Markdown-Abschnitte: Kurzlösung, Lösungsweg, Quellen
  // Kleine Abweichungen werden toleriert
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

// Antwortsprache: Sprache der Frage, sonst Deutsch
// Einfache Erkennung über typische Wörter und Umlaute
function detectQuestionLanguage(question: string): "de" | "en" {
  const q = question.toLowerCase();
  // Umlaute und ß: fast sicher Deutsch
  if (/[äöüß]/.test(q)) return "de";
  // Deutsche Funktionswörter
  const deWords =
    /\b(der|die|das|und|nicht|ist|sind|wie|was|wer|warum|wenn|dass|für|mit|von|auf|aus|nach|über|kann|werden|wurde|hat|hatte|sein|haben|sich|nur|auch|aber|noch|schon|mehr|sehr|durch|über|ohne|zwischen|gegen|wäre|würde|sollte|könnte)\b/;
  // Englische Funktionswörter
  const enWords =
    /\b(the|and|of|to|in|is|it|for|on|with|as|by|that|this|are|be|was|were|will|would|should|could|can|do|does|did|have|has|had|what|how|why|when|where|which|who|whom|whose)\b/;
  const deHits = (q.match(new RegExp(deWords, "g")) ?? []).length;
  const enHits = (q.match(new RegExp(enWords, "g")) ?? []).length;
  if (deHits === 0 && enHits === 0) return "de"; // very short / neutral → default DE
  return enHits > deHits ? "en" : "de";
}

async function askImpl(params: {
  sessionId: string;
  question: string;
}): Promise<TutorAnswer> {
  const session = getChatSession(params.sessionId);
  if (!session) throw new Error("session_not_found");
  const question = params.question.trim();
  if (!question) throw new Error("question_empty");

  const history = listChatMessages(params.sessionId);
  // Heftstellen plus Katalog-Einträge; ohne Embedder reichen auch Katalog-Treffer
  // Kurze Nachfragen („und wie berechnet man die?“) allein finden nichts: die vorige Frage mitsuchen
  const prevQuestion = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const searchQuery = prevQuestion && question.split(/\s+/).length < 12 ? `${prevQuestion}\n${question}` : question;
  const hits = retrieveMaterial(searchQuery, session.module_id);
  let chunks: TutorSource[] = [];
  let conceptNet = "";
  try {
    ({ sources: chunks, conceptNet } = await retrieveChunks(searchQuery, session.module_id));
  } catch (err) {
    if (!hits.length) throw err;
  }
  const sources = [...chunks, ...materialSources(hits, chunks.length + 1)];
  if (sources.length === 0) {
    throw new Error("no_chunks_in_scope");
  }

  // Sprache pro Runde: Prompt und Antwort einsprachig
  const language = detectQuestionLanguage(question);
  // Gemeinsame Bereinigungs-Hinweise: Kopfzeilen und kaputte Formeln
  const baseSystem =
    getPrompt(language === "en" ? "tutor.en" : "tutor.de");
  const systemPrompt = `${baseSystem}\n\n${cleanupHints(language)}`;

  const prompt = buildPrompt(history, question, sources, language, conceptNet);
  const result = await generate({
    prompt,
    system: systemPrompt,
    options: {
      temperature: 0.2,
      // num_ctx reicht für bis zu 20 Abschnitte + Begriffsnetz + Verlauf + Antwort (rund 12 000 Token)
      num_ctx: 32768,
      // 4096: lange Antworten nicht mitten im Satz abschneiden
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
  // Zeitstempel in ms, Frage 1 ms vor der Antwort: eindeutige Reihenfolge
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

  // Titel aus der ersten Frage, falls noch keiner
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

export function ask(...args: Parameters<typeof askImpl>): ReturnType<typeof askImpl> {
  return runJob("tutor", "tutor", {}, () => askImpl(...args));
}
