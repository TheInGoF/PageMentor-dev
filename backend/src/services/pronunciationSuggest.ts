// Gemma schlägt Aussprache vor: für eingegebene Wörter oder für Anglizismen, die sie in einem Heft findet.
// Geprüfte Einträge dienen als Beispiele; Vorschläge kommen ungeprüft in die Liste, der Nutzer hört und hakt ab.
import { db } from "../db";
import { generate } from "./llm";
import { withGemmaLock } from "./gemmaLock";
import { examplesBlock, pronunciationList, type PronunciationEntry } from "./pronunciation";

const SYSTEM = `Du hilfst einer deutschen Sprachausgabe. Die Stimme liest jedes Wort wie ein deutsches Wort.
Schreibe für jedes Wort, wie man es mit deutschen Buchstaben schreiben muss, damit es richtig klingt:
- Englische Wörter und Namen in deutscher Lautschrift: "Workflow" → "Wörkflou", "PageMentor" → "Pejdsch-Mentor".
- Abkürzungen mit deutschen Buchstabennamen: "TTS" → "Teh Teh Ess", "API" → "A Peh I".
- Ziffern ausschreiben, wenn sie zum Namen gehören: "F5" → "Eff fünf".
- Deutsche Wörter und im Deutschen übliche Lehnwörter lässt du weg.
Antworte nur als JSON: {"items":[{"from":"Wort","to":"so gesprochen"}]}`;

const SCHEMA = {
  type: "object",
  properties: { items: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } } },
  required: ["items"],
};

async function ask(prompt: string, model?: string): Promise<PronunciationEntry[]> {
  const ex = examplesBlock();
  const r = await withGemmaLock("pronunciation", () =>
    generate({ prompt, system: ex ? `${SYSTEM}\n\n${ex}` : SYSTEM, model, format: SCHEMA, options: { temperature: 0.2, num_ctx: 8192, num_predict: 2048 } })
  );
  try {
    const items = (JSON.parse(r.response ?? "{}") as { items?: PronunciationEntry[] }).items ?? [];
    const known = new Set(pronunciationList().entries.map((e) => e.from.toLowerCase()));
    const seen = new Set<string>();
    return items
      .map((e) => ({ from: String(e.from ?? "").trim(), to: String(e.to ?? "").trim() }))
      .filter((e) => e.from && e.to && e.from !== e.to && !known.has(e.from.toLowerCase()) && !seen.has(e.from.toLowerCase()) && seen.add(e.from.toLowerCase()));
  } catch {
    return [];
  }
}

export function suggestFor(words: string[], model?: string): Promise<PronunciationEntry[]> {
  const list = words.map((w) => w.trim()).filter(Boolean);
  if (!list.length) return Promise.resolve([]);
  return ask(`Wörter:\n${list.join("\n")}`, model);
}

// Ein Heft durchsehen: Ausschnitte aus allen Kapiteln, höchstens ~12 000 Zeichen
export function suggestFromDocument(docId: string, model?: string): Promise<PronunciationEntry[]> {
  const rows = db().prepare("SELECT COALESCE(audio_text, text) AS t FROM chapters WHERE document_id = ? ORDER BY sort_order, number").all(docId) as Array<{ t: string }>;
  const per = Math.max(800, Math.floor(12_000 / Math.max(1, rows.length)));
  const sample = rows.map((r) => (r.t ?? "").slice(0, per)).join("\n\n").slice(0, 12_000);
  if (!sample.trim()) return Promise.resolve([]);
  return ask(`Finde in diesem Text englische Wörter, Produktnamen und Abkürzungen, die eine deutsche Stimme falsch aussprechen würde, höchstens 30:\n\n${sample}`, model);
}
