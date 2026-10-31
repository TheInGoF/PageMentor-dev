// Gemma liest jedes Kapitel einmal und schreibt Fachbegriffe samt Voraussetzungen heraus.
// Läuft als Warteschlange im Hintergrund (Fortschritt per Abfrage), Kapitel für Kapitel, und nur, wenn keine Umwandlung
// und kein Hörbuch die Grafikkarte braucht. Fertige Kapitel tragen einen Stempel und werden übersprungen
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../../db";
import { emitLog } from "../../log/logger";
import { runJob } from "../../log/jobs";
import { generate } from "../llm";
import { withGemmaLock } from "../gemmaLock";
import { getPrompt } from "../prompts";
import { splitForPreprocess } from "../audioPreprocess/textCleanup";
import { embeddingToBuffer, embedText, resolveEmbedder } from "../embeddings";
import { anyProcessing } from "../pipeline";
import { anyGenerating } from "../audiobook";
import { normalizeConcept, saveChapterConcepts, type ExtractedConcept } from "./store";

const VERSION = 1;
// Längere Kapitel in Stücken; mehr als sechs Stücke bringen kaum neue Begriffe
const PIECE_CHARS = 8000;
const MAX_PIECES = 6;

const SCHEMA = {
  type: "object",
  properties: {
    begriffe: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          erklaerung: { type: "string" },
          erklaert: { type: "boolean" },
          baut_auf: { type: "array", items: { type: "string" } },
        },
        required: ["name", "erklaerung", "erklaert", "baut_auf"],
      },
    },
  },
  required: ["begriffe"],
};

export function conceptsStamp(): string {
  return createHash("sha1").update(`${VERSION}|${getPrompt("concepts.de")}`).digest("hex").slice(0, 12);
}

// Antwort lesen; kaputtes JSON gibt eine leere Liste statt eines Abbruchs
export function parseConcepts(raw: string): ExtractedConcept[] {
  try {
    const start = raw.indexOf("{");
    const data = JSON.parse(start >= 0 ? raw.slice(start, raw.lastIndexOf("}") + 1) : raw) as {
      begriffe?: Array<{ name?: string; erklaerung?: string; erklaert?: boolean; baut_auf?: string[] }>;
    };
    return (data.begriffe ?? [])
      .filter((b) => typeof b.name === "string" && b.name.trim().length >= 3 && b.name.length <= 60)
      .map((b) => ({
        name: b.name!.trim(),
        definition: (b.erklaerung ?? "").trim().slice(0, 400),
        explains: !!b.erklaert,
        needs: (b.baut_auf ?? []).filter((n) => typeof n === "string" && n.trim().length >= 3).map((n) => n.trim()).slice(0, 4),
      }));
  } catch {
    return [];
  }
}

// Ergebnisse mehrerer Stücke zusammenführen: einmal je Begriff, "erklärt" gewinnt
export function mergeConcepts(lists: ExtractedConcept[][]): ExtractedConcept[] {
  const byNorm = new Map<string, ExtractedConcept>();
  for (const it of lists.flat()) {
    const k = normalizeConcept(it.name);
    const cur = byNorm.get(k);
    if (!cur) byNorm.set(k, { ...it, needs: [...it.needs] });
    else {
      cur.explains ||= it.explains;
      if (it.definition.length > cur.definition.length) cur.definition = it.definition;
      for (const n of it.needs) if (!cur.needs.includes(n)) cur.needs.push(n);
    }
  }
  return [...byNorm.values()];
}

async function extractChapter(ch: { id: string; document_id: string; title: string; text: string }, model?: string): Promise<number> {
  const pieces = splitForPreprocess(ch.text, PIECE_CHARS).slice(0, MAX_PIECES);
  const lists: ExtractedConcept[][] = [];
  for (const piece of pieces) {
    const r = await withGemmaLock(`concepts ${ch.title.slice(0, 30)}`, () =>
      generate({
        prompt: `Abschnitt „${ch.title}“:\n\n${piece}`,
        system: getPrompt("concepts.de"),
        model,
        format: SCHEMA,
        options: { temperature: 0.1, num_ctx: 16384, num_predict: 3000 },
      })
    ).catch((err) => {
      console.warn(`[concepts] Stück übersprungen: ${err instanceof Error ? err.message : err}`);
      return null;
    });
    if (r) lists.push(parseConcepts(r.response));
  }
  // Kein einziges Stück beantwortet (Gemma nicht erreichbar): ohne Stempel lassen, damit es später nachgeholt wird
  if (!lists.length) throw new Error("Gemma hat kein Stück beantwortet");
  const items = mergeConcepts(lists);
  saveChapterConcepts(ch.id, ch.document_id, items, conceptsStamp());
  return items.length;
}

// Begriffe ohne Vektor einbetten, damit Fragen sie über die Bedeutung finden
async function embedNewConcepts(): Promise<void> {
  const embedder = await resolveEmbedder().catch(() => null);
  if (!embedder) return;
  const rows = db().prepare("SELECT id, name, definition FROM concepts WHERE embedding IS NULL LIMIT 2000").all() as Array<{ id: string; name: string; definition: string | null }>;
  for (const r of rows) {
    try {
      const v = await embedText(r.definition ? `${r.name}: ${r.definition}` : r.name, embedder, "passage");
      db().prepare("UPDATE concepts SET embedding = ? WHERE id = ?").run(embeddingToBuffer(v), r.id);
    } catch {
      return;
    }
  }
}

// Offene Kapitel: Lerninhalt mit genug Text, noch ohne aktuellen Stempel
export function openChapters(docIds?: string[]): Array<{ id: string; document_id: string; title: string; text: string }> {
  const filter = docIds?.length ? ` AND c.document_id IN (${docIds.map(() => "?").join(",")})` : "";
  return db()
    .prepare(
      `SELECT c.id, c.document_id, c.title, c.text FROM chapters c
        WHERE c.kind IN ('content', 'summary') AND length(c.text) >= 200 AND (c.concepts_stamp IS NULL OR c.concepts_stamp != ?)${filter}
        ORDER BY c.document_id, c.sort_order, c.number`
    )
    .all(conceptsStamp(), ...(docIds ?? [])) as Array<{ id: string; document_id: string; title: string; text: string }>;
}

export interface ConceptRunState {
  running: boolean;
  done: number;
  total: number;
  current?: string;
  // Heft des aktuellen Kapitels
  doc?: string;
}

const state: ConceptRunState = { running: false, done: 0, total: 0 };
const queue = new Set<string>();
let cancel = false;

export function conceptRunState(): ConceptRunState {
  return { ...state };
}

export function cancelConceptRun(): void {
  cancel = true;
  queue.clear();
}

// Hefte vormerken; ein laufender Durchgang nimmt sie mit
export function enqueueConcepts(docIds: string[], model?: string): ConceptRunState {
  for (const id of docIds) queue.add(id);
  if (!state.running) void run(model);
  else state.total = state.done + openChapters([...queue]).length;
  return conceptRunState();
}

async function run(model?: string): Promise<void> {
  state.running = true;
  cancel = false;
  state.done = 0;
  let failures = 0;
  try {
    await runJob("concepts", "concepts", {}, async () => {
      while (queue.size && !cancel) {
        const docs = [...queue];
        const open = openChapters(docs);
        state.total = state.done + open.length;
        if (!open.length) break;
        for (const ch of open) {
          // Nie zwei Dinge gleichzeitig auf der Grafikkarte: Umwandlung und Hörbuch haben Vorrang
          while (!cancel && (anyProcessing() || anyGenerating())) await sleep(5000);
          if (cancel) break;
          state.current = ch.title;
          state.doc = (db().prepare("SELECT title FROM documents WHERE id = ?").get(ch.document_id) as { title: string } | undefined)?.title;
          const n = await extractChapter(ch, model).catch((err) => {
            emitLog("warn", "concepts", `Begriffe für „${ch.title}“ fehlgeschlagen`, { err });
            failures++;
            return -1;
          });
          if (n >= 0) failures = 0;
          // Drei Fehlschläge in Folge: Gemma ist weg, nicht das ganze Heft durchprobieren
          if (failures >= 3) {
            emitLog("warn", "concepts", "Begriffsnetz angehalten: Gemma antwortet nicht");
            cancel = true;
            break;
          }
          console.log(`[concepts] ${ch.title}: ${n} Begriffe`);
          state.done++;
        }
        for (const d of docs) queue.delete(d);
      }
      await embedNewConcepts();
    });
  } finally {
    state.running = false;
    state.current = undefined;
    state.doc = undefined;
  }
}
