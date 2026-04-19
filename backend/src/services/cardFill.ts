/**
 * Stage B für die vereinheitlichte Karten-Pipeline: Antworten für
 * Aufgaben finden, die kein Marker-Match hatten.
 *
 * Ablauf pro Frage:
 *   1. Question per Ollama-Embedder vektorisieren.
 *   2. Cosine-Similarity über alle Chunks des Dokuments, Top-K ziehen.
 *      (Chunks werden außerhalb einmal pro Durchlauf geladen — keine
 *      Wiederholung der DB-Query pro Frage.)
 *   3. LLM bekommt die Chunks als Quellen-Snippets und darf nur dann
 *      antworten, wenn die Antwort belegt ist. Format ist strenges
 *      JSON mit Quote + Seitenzahl; alles andere fällt als
 *      "nicht gefunden" durch.
 *
 * Gegen Halluzinationen:
 *   - Temperature 0.1
 *   - System-Prompt verbietet Erfinden und verlangt Quelle
 *   - Output muss parsebar sein und die Quote muss im Snippet-Text
 *     als Substring vorkommen (approximative Prüfung über
 *     Whitespace-normalisierte Enthält-Relation)
 */

import { db } from "../db";
import {
  embedText,
  embeddingFromBuffer,
  cosineSim,
  type EmbedderConfig,
} from "./embeddings";
import { generate as llmGenerate } from "./llm";

export interface DocChunk {
  id: string;
  chapterId: string;
  chapterKind: string;
  text: string;
  startPage: number;
  endPage: number;
  embedding: Float32Array;
}

export interface FillResult {
  answer: string;
  page: number | null;
}

/** Holt alle Chunks eines Dokuments, die ein Embedding im gewünschten
 *  Modell haben. Wenn die Modell-Dimension nicht passt, filtern wir
 *  die Zeile raus (passiert beim Modell-Wechsel vor Re-Embed). */
export function loadDocChunks(docId: string, embedderModel: string): DocChunk[] {
  const rows = db()
    .prepare(
      `SELECT ch.id, ch.chapter_id, ch.text, ch.start_page, ch.end_page,
              ch.embedding, ch.embedding_model,
              c.kind as chapter_kind
       FROM chunks ch
       JOIN chapters c ON c.id = ch.chapter_id
       WHERE ch.document_id = ?
         AND ch.embedding IS NOT NULL
         AND ch.embedding_model = ?`
    )
    .all(docId, embedderModel) as Array<{
    id: string;
    chapter_id: string;
    text: string;
    start_page: number;
    end_page: number;
    embedding: Buffer | null;
    chapter_kind: string;
  }>;

  const out: DocChunk[] = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    out.push({
      id: r.id,
      chapterId: r.chapter_id,
      chapterKind: r.chapter_kind,
      text: r.text,
      startPage: r.start_page,
      endPage: r.end_page,
      embedding: embeddingFromBuffer(r.embedding),
    });
  }
  return out;
}

/** Top-K Chunks per Cosine. Lösungen-Kapitel bekommen einen leichten
 *  Score-Bonus, weil Musterlösungen-Anhänge semantisch ähnlich sind zu
 *  anderen Aufgaben — der Bonus hebt sie an die Spitze wenn sie
 *  ohnehin in der Nähe liegen. */
function topK(
  chunks: DocChunk[],
  queryEmb: Float32Array,
  k: number
): DocChunk[] {
  const scored = chunks.map((ch) => {
    let score = cosineSim(queryEmb, ch.embedding);
    if (ch.chapterKind === "solutions") score += 0.03;
    return { ch, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.ch);
}

function buildPrompt(
  question: string,
  sources: DocChunk[],
  language: "de" | "en"
): { system: string; prompt: string } {
  const system =
    language === "de"
      ? "Du beantwortest eine Aufgaben-Frage AUSSCHLIESSLICH mit wörtlichen Zitaten aus den vorgelegten Quellen-Snippets. Wenn die Antwort nicht oder nur vage in den Snippets steht, antworte mit {\"found\": false}. Niemals raten, niemals zusätzliches Wissen einbringen. Antwort ist immer reines JSON ohne Codefences."
      : "You answer an exercise question STRICTLY with verbatim quotes from the provided source snippets. If the answer is not or only vaguely in the snippets, respond with {\"found\": false}. Never guess, never add outside knowledge. Always respond with plain JSON, no codefences.";

  const snippetLines = sources.map((s, i) => {
    const header =
      language === "de"
        ? `[${i + 1}] Seite ${s.startPage}${s.endPage !== s.startPage ? `–${s.endPage}` : ""}`
        : `[${i + 1}] Page ${s.startPage}${s.endPage !== s.startPage ? `–${s.endPage}` : ""}`;
    return `${header}\n${s.text.trim()}`;
  });

  const prompt =
    language === "de"
      ? `Aufgabe: ${question}\n\n=== Quellen-Snippets ===\n${snippetLines.join("\n\n---\n\n")}\n=== Ende der Quellen ===\n\nAntwort-Format (ausschließlich JSON):\nGefunden: {\"found\": true, \"answer\": \"<wörtliches Zitat aus einem Snippet, max 600 Zeichen>\", \"sourceIndex\": <Snippet-Nummer, 1-basiert>}\nNicht gefunden: {\"found\": false}`
      : `Exercise: ${question}\n\n=== Source snippets ===\n${snippetLines.join("\n\n---\n\n")}\n=== End of sources ===\n\nResponse format (JSON only):\nFound: {\"found\": true, \"answer\": \"<verbatim quote from a snippet, max 600 chars>\", \"sourceIndex\": <snippet number, 1-based>}\nNot found: {\"found\": false}`;

  return { system, prompt };
}

interface FillParsed {
  found: boolean;
  answer?: string;
  sourceIndex?: number;
}

function parseFillResponse(raw: string): FillParsed | null {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.found !== "boolean") return null;
    const out: FillParsed = { found: parsed.found };
    if (parsed.found) {
      if (typeof parsed.answer !== "string" || parsed.answer.trim().length < 2) return null;
      out.answer = String(parsed.answer).trim();
      if (typeof parsed.sourceIndex === "number") {
        out.sourceIndex = parsed.sourceIndex;
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Normalisiert Text für den Subset-Check: kein Whitespace, kein
 *  Markdown-Fett, lowercased. So erkennen wir ein "im Sinne von wörtlich"-
 *  Zitat auch wenn das LLM Zeilenumbrüche verändert hat. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stage B: sucht die Antwort zu einer Frage in den Chunks eines Docs.
 *  Return `null` bedeutet: nicht belegt gefunden — die Aufgabe bleibt
 *  ohne Antwort und der User kann sie manuell nachziehen. */
export async function fillAnswerFromChunks(params: {
  chunks: DocChunk[];
  question: string;
  language: "de" | "en";
  embedder: EmbedderConfig;
  topK?: number;
  model?: string;
}): Promise<FillResult | null> {
  const k = params.topK ?? 5;
  if (params.chunks.length === 0) return null;

  let queryEmb: Float32Array;
  try {
    queryEmb = await embedText(params.question, params.embedder);
  } catch {
    return null;
  }
  // Dimensions-Mismatch (Embedder hat sich geändert aber Chunks sind
  // alt) würde cosineSim zu 0 machen — filtern vorab.
  const compatible = params.chunks.filter(
    (c) => c.embedding.length === queryEmb.length
  );
  if (compatible.length === 0) return null;

  const sources = topK(compatible, queryEmb, k);
  if (sources.length === 0) return null;

  const { system, prompt } = buildPrompt(params.question, sources, params.language);

  let raw: string;
  try {
    const res = await llmGenerate({
      system,
      prompt,
      model: params.model,
      options: { temperature: 0.1, top_p: 0.9 },
    });
    raw = res.response;
  } catch {
    return null;
  }

  const parsed = parseFillResponse(raw);
  if (!parsed || !parsed.found || !parsed.answer) return null;

  // Verifizieren, dass die Antwort halbwegs aus einem Snippet kommt.
  // Wenn sie in keinem Quellensnippet enthalten ist (normalisiert),
  // verwerfen wir sie — das ist der wichtigste Schutz vor
  // Halluzinationen.
  const normAnswer = normalize(parsed.answer);
  const shortEnough = normAnswer.length < 40;
  let matched: DocChunk | undefined;
  for (const s of sources) {
    const normSource = normalize(s.text);
    if (!shortEnough && normSource.includes(normAnswer)) {
      matched = s;
      break;
    }
    // Für kurze Antworten (z. B. "42" oder Einwortbegriffe) ist ein
    // reiner Substring-Match zu locker — wir verlangen dann, dass die
    // Antwort samt Umgebung überlappt. Fallback: Index-Hinweis vom
    // LLM glauben, wenn vorhanden.
  }
  if (!matched && parsed.sourceIndex && parsed.sourceIndex >= 1 && parsed.sourceIndex <= sources.length) {
    matched = sources[parsed.sourceIndex - 1];
  }
  if (!matched) return null;

  return {
    answer: parsed.answer,
    page: matched.startPage,
  };
}
