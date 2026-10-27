// Vergleich: gleicher Textausschnitt mit je einer Stimme pro Engine, nacheinander
// Ablage audio/compare/<docId>/<runId>/<engine>.mp3 plus run.json
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { runJob } from "../../log/jobs";
import { newId } from "../../log/context";
import { findVoice } from "../../tts/voices";
import { synthesizeChunk } from "../../tts/synth";

// Ausschnitt so lang, dass Klang und Betonung hörbar sind
const SAMPLE_CHARS = 600;

export interface CompareItem {
  engine: string;
  voiceId: string;
  voiceLabel: string;
  status: "wartet" | "läuft" | "fertig" | "fehler";
  file?: string;
  ms?: number;
  error?: string;
}

export interface CompareRun {
  id: string;
  docId: string;
  chapterId: string;
  text: string;
  startedAt: number;
  finishedAt?: number;
  items: CompareItem[];
}

const runs = new Map<string, CompareRun>();

export function compareRun(docId: string): CompareRun | null {
  return runs.get(docId) ?? null;
}

export function compareDir(docId: string, runId: string): string {
  return join(DATA_DIR, "audio", "compare", docId, runId);
}

// Bis zum letzten Satzende vor der Grenze
function sampleText(text: string): string {
  const t = text.trim();
  if (t.length <= SAMPLE_CHARS) return t;
  const cut = t.slice(0, SAMPLE_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > SAMPLE_CHARS / 3 ? cut.slice(0, end + 1) : cut;
}

export function startCompare(docId: string, chapterId: string, voiceIds: string[]): CompareRun {
  const cur = runs.get(docId);
  if (cur && !cur.finishedAt) throw new Error("Für dieses Dokument läuft schon ein Vergleich");
  const row = db().prepare("SELECT text, audio_text FROM chapters WHERE id = ? AND document_id = ?").get(chapterId, docId) as
    | { text: string; audio_text: string | null }
    | undefined;
  if (!row) throw new Error("Kapitel nicht gefunden");
  const voices = voiceIds.map((id) => findVoice(id)).filter((v) => !!v);
  if (!voices.length) throw new Error("Keine gültige Stimme");

  const run: CompareRun = {
    id: newId("cmp"),
    docId,
    chapterId,
    text: sampleText(row.audio_text || row.text),
    startedAt: Date.now(),
    items: voices.map((v) => ({ engine: v.engine, voiceId: v.id, voiceLabel: v.label, status: "wartet" })),
  };
  runs.set(docId, run);
  void runJob("compare", "tts", { docId }, () => execute(run));
  return run;
}

async function execute(run: CompareRun): Promise<void> {
  const dir = compareDir(run.docId, run.id);
  mkdirSync(dir, { recursive: true });
  const save = () => writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 2));
  save();
  for (const item of run.items) {
    const voice = findVoice(item.voiceId);
    item.status = "läuft";
    save();
    const t0 = Date.now();
    try {
      if (!voice) throw new Error("Stimme verschwunden");
      const outPath = join(dir, `${item.engine}.mp3`);
      await synthesizeChunk({ segment: { paragraphs: [run.text] }, text: run.text, voice, locale: voice.locale, rate: "+0%", outPath });
      item.file = `${item.engine}.mp3`;
      item.status = "fertig";
    } catch (err) {
      item.status = "fehler";
      item.error = err instanceof Error ? err.message : String(err);
    }
    item.ms = Date.now() - t0;
    save();
  }
  run.finishedAt = Date.now();
  save();
}

export function compareFile(docId: string, engine: string): string | null {
  const run = runs.get(docId);
  const item = run?.items.find((i) => i.engine === engine && i.file);
  if (!run || !item?.file) return null;
  const p = join(compareDir(docId, run.id), item.file);
  return existsSync(p) ? p : null;
}
