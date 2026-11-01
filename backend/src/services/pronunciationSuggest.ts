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

// Wortprüfung: Die Stimme sprach die bisherigen Schreibweisen, Whisper hörte etwas anderes. Je Wort eine neue,
// andere Lautschrift, näher am Original; Wörter aus der Liste sind hier erlaubt
export async function retrySpelling(items: Array<{ from: string; tried: string[]; heard: string }>, model?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!items.length) return out;
  const prompt =
    "Die deutsche Stimme hat diese Schreibweisen gesprochen, Whisper hat etwas anderes gehört. Schreibe je Wort eine neue, andere Lautschrift mit deutschen Buchstaben, die näher am Original klingt. Nutze keine der bisherigen Schreibweisen noch einmal.\n\n" +
    items.map((i) => `Wort: ${i.from}\nBisher: ${i.tried.join(", ")}\nGehört: ${i.heard || "(nichts)"}`).join("\n\n");
  const ex = examplesBlock();
  const r = await withGemmaLock("pronunciation", () =>
    generate({ prompt, system: ex ? `${SYSTEM}\n\n${ex}` : SYSTEM, model, think: false, format: SCHEMA, options: { temperature: 0.4, num_ctx: 8192, num_predict: 2048 } })
  );
  try {
    const wanted = new Map(items.map((i) => [i.from.toLowerCase(), i]));
    for (const e of (JSON.parse(r.response ?? "{}") as { items?: PronunciationEntry[] }).items ?? []) {
      const from = String(e.from ?? "").trim();
      const to = String(e.to ?? "").trim();
      const item = wanted.get(from.toLowerCase());
      if (item && to && !item.tried.some((t) => t.toLowerCase() === to.toLowerCase()) && to.toLowerCase() !== item.from.toLowerCase()) out.set(item.from, to);
    }
  } catch {
    /* kaputte Antwort: keine neuen Vorschläge */
  }
  return out;
}

// Aus der Bereinigung: nur die Paare behalten, bei denen die rechte Seite eine Lautschrift der linken ist
export async function confirmRespellings(pairs: Array<{ from: string; to: string }>, model?: string): Promise<PronunciationEntry[]> {
  if (!pairs.length) return [];
  const prompt =
    "Diese Wortpaare stammen aus dem Vergleich eines Hefttexts mit seiner Fassung für die Sprachausgabe (links Original, rechts Fassung). Gib nur die Paare zurück, bei denen rechts eine Lautschrift steht, also das Wort so geschrieben, wie die deutsche Stimme es richtig ausspricht. Keine Übersetzungen, keine ausgeschriebenen Abkürzungen wie Professor oder Doktor, keine Umformulierungen.\n\n" +
    pairs.map((p) => `${p.from} → ${p.to}`).join("\n");
  const r = await withGemmaLock("pronunciation", () =>
    generate({ prompt, system: SYSTEM, model, think: false, format: SCHEMA, options: { temperature: 0.1, num_ctx: 8192, num_predict: 2048 } })
  );
  try {
    const wanted = new Map(pairs.map((p) => [p.from.toLowerCase(), p]));
    const out: PronunciationEntry[] = [];
    const seen = new Set<string>();
    for (const e of (JSON.parse(r.response ?? "{}") as { items?: PronunciationEntry[] }).items ?? []) {
      const p = wanted.get(String(e.from ?? "").trim().toLowerCase());
      if (p && !seen.has(p.from) && seen.add(p.from)) out.push({ from: p.from, to: p.to });
    }
    return out;
  } catch {
    return [];
  }
}
