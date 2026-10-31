// Gesprächsgedächtnis des Tutors: Runden, die aus dem Arbeitsfenster fallen, werden nicht weggeworfen,
// sondern gezielt verdichtet. Fachliches, gute Antworten sowie Fehler mit ihrer Korrektur bleiben,
// Abschweifungen fallen weg. Verdichtet wird gebündelt (ab drei Runden) oder sofort, wenn das Fenster voll ist
import { db } from "../../db";
import { generate } from "../llm";
import { getPrompt } from "../prompts";
import type { ChatMessageRow, ChatSessionRow, TutorAnswer } from "./types";

// Ab so vielen Runden außerhalb des Fensters wird verdichtet: seltener rechnen, nichts verlieren
const FOLD_BATCH = 3;
// Ab dieser Auslastung des Kontexts sofort verdichten und nur die letzten zwei Runden behalten
const FULL_RATIO = 0.8;
const FULL_KEEP_TURNS = 2;

export interface WindowPlan {
  // Ins Gedächtnis zu verdichten (älteste zuerst)
  fold: ChatMessageRow[];
  // Bleiben wörtlich im Prompt
  keep: ChatMessageRow[];
}

// Runden = Frage plus Antwort; maßgeblich ist, was nach dem Gedächtnis kam
export function planWindow(history: ChatMessageRow[], memoryUpto: string | null, turns: number, lastRatio: number): WindowPlan {
  const open = memoryUpto ? history.filter((m) => m.created_at > memoryUpto) : history;
  const rounds: ChatMessageRow[][] = [];
  for (const m of open) {
    if (m.role === "user" || !rounds.length) rounds.push([m]);
    else rounds[rounds.length - 1].push(m);
  }
  const full = lastRatio >= FULL_RATIO;
  const keepTurns = full ? Math.min(turns, FULL_KEEP_TURNS) : turns;
  const over = rounds.length - keepTurns;
  if (over >= FOLD_BATCH || (full && over > 0)) {
    return { fold: rounds.slice(0, over).flat(), keep: rounds.slice(over).flat() };
  }
  return { fold: [], keep: open };
}

// Auslastung der letzten Antwort (0–1), aus der gespeicherten Antwort
export function lastUsageRatio(history: ChatMessageRow[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "assistant") continue;
    try {
      const u = (JSON.parse(history[i].content) as TutorAnswer).usage;
      return u && u.ctx ? (u.promptTokens + u.outputTokens) / u.ctx : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function asText(m: ChatMessageRow): string {
  if (m.role === "user") return `Lernender: ${m.content}`;
  try {
    const a = JSON.parse(m.content) as TutorAnswer;
    return `Tutor: ${a.shortAnswer}\n${a.reasoning}`.slice(0, 4000);
  } catch {
    return `Tutor: ${m.content.slice(0, 4000)}`;
  }
}

// Ältere Runden ins Gedächtnis aufnehmen; scheitert das Modell, bleibt das alte Gedächtnis und die Runden
// gelten trotzdem als aufgenommen (sie sind ohnehin aus dem Fenster)
export async function foldIntoMemory(session: ChatSessionRow, fold: ChatMessageRow[], model: string | undefined): Promise<{ memory: string; turns: number }> {
  const before = session.memory ?? "";
  const turns = (session.memory_turns ?? 0) + fold.filter((m) => m.role === "user").length;
  let memory = before;
  try {
    const r = await generate({
      prompt: `Bisheriges Gedächtnis:\n${before || "(leer)"}\n\nÄltere Gesprächsrunden:\n\n${fold.map(asText).join("\n\n")}`,
      system: getPrompt("tutor-memory.de"),
      model,
      think: model?.startsWith("qwen") ? false : undefined,
      options: { temperature: 0.1, num_ctx: 16384, num_predict: 1200 },
    });
    if (r.response.trim().length > 40) memory = r.response.trim();
  } catch (err) {
    console.warn(`[tutor] Gedächtnis nicht verdichtet: ${err instanceof Error ? err.message : err}`);
  }
  db().prepare("UPDATE chat_sessions SET memory = ?, memory_upto = ?, memory_turns = ? WHERE id = ?").run(memory || null, fold[fold.length - 1].created_at, turns, session.id);
  return { memory, turns };
}
