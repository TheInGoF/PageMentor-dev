// Karten aus einem Textstück: LLM-Aufruf, JSON lesen, Qualität prüfen
import { withGemmaLock } from "../gemmaLock";
import { generate as llmGenerate } from "../llm";
import { cleanupHints } from "../promptHints";
import { getPrompt } from "../prompts";
import type { Card } from "./types";

// Kapitelarten ohne Aufgaben
export const SKIP_KINDS = new Set(["index", "references", "meta", "other"]);

export function dedupKey(q: string): string {
  return q
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9äöüß ]/g, "")
    .trim()
    .slice(0, 160);
}

// Text in Stücke mit Überlappung teilen, bevorzugt an Absätzen
export function chunkText(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + size);
    if (end < text.length) {
      // Absatzgrenze bis 300 Zeichen vor dem Schnitt suchen
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

export async function extractCardsFromChunk(
  chunk: string,
  chapterTitle: string,
  chapterNumber: number,
  lang: "de" | "en",
  pinnedModel: string,
  docOutline: string
): Promise<Card[]> {
  const system = getPrompt(lang === "de" ? "cards.de" : "cards.en").replace(
    "{{CLEANUP_HINTS}}",
    () => cleanupHints(lang)
  );

  // Übersicht + aktuelles Kapitel mitgeben: Beispiel 5.2 vs. 5.3 unterscheidbar
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
    // Anfang und Ende der Antwort loggen, nicht alles
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
  // Normalfall: sauberes JSON
  try {
    const arr = JSON.parse(trimmed) as unknown;
    return normalizeArray(arr);
  } catch {
    // Fallback: erstes vollständiges [ ... ] herausziehen
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

// Grund zum Verwerfen einer Karte oder null
// Fängt Echos ab: Antwort steckt in der Frage oder umgekehrt
function qualityRejection(q: string, a: string): string | null {
  if (q.length < 8) return "question too short";
  if (a.length < 30) return "answer too short (<30 chars)";

  // Echo: eine Seite steckt wörtlich in der anderen
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

// Erstes ausbalanciertes JSON-Array finden
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
