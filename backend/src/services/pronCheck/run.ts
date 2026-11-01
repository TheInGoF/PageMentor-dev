// Ausspracheprüfung im Hintergrund: Kapitel für Kapitel abhören (Whisper), mit dem Soll-Text abgleichen, Befunde speichern.
// Wartet wie alle GPU-Arbeit, bis Umwandlung, Hörbuch oder Lernhörbuch-Einheit fertig sind
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../../db";
import { emitLog } from "../../log/logger";
import { runJob } from "../../log/jobs";
import { fromDataPath } from "../../paths";
import { anyProcessing } from "../pipeline";
import { anyGenerating } from "../audiobook";
import { learnUnitActive } from "../learnbook/run";
import { findIssues, tokens } from "./align";
import { saveCheck } from "./store";
import { isNoise } from "./noise";
import { transcribe } from "./stt";

export interface PronRunState {
  docId: string;
  running: boolean;
  waiting?: boolean;
  done: number;
  total: number;
  current?: string;
  found: number;
  error?: string;
}

let state: PronRunState | null = null;
let cancel = false;

export function pronRunState(): PronRunState | null {
  return state ? { ...state } : null;
}

export function cancelPronCheck(): void {
  cancel = true;
}

// Soll-Text wie gesprochen: Kapitelansage, dann der aufbereitete Text; Sprachmarken [es]…[/es] fallen weg
export function expectedText(ch: { number: number; title: string | null; text: string; audio_text: string | null }, language: string): string {
  const de = language.startsWith("de");
  const title = ch.title?.trim();
  const announcement = title ? `${de ? "Kapitel" : "Chapter"}: ${title}.` : ch.number > 0 ? `${de ? "Kapitel" : "Chapter"} ${ch.number}.` : "";
  const body = (ch.audio_text || ch.text).replace(/\[\/?[a-z]{2}\]/g, " ");
  return `${announcement} ${body}`.trim();
}

export function startPronCheck(docId: string, chapterIds: string[]): PronRunState {
  if (state?.running) return state;
  state = { docId, running: true, done: 0, total: chapterIds.length, found: 0 };
  cancel = false;
  void run(docId, chapterIds);
  return state;
}

async function run(docId: string, chapterIds: string[]): Promise<void> {
  const st = state!;
  try {
    await runJob("proncheck", "proncheck", { docId }, async () => {
      const doc = db().prepare("SELECT language FROM documents WHERE id = ?").get(docId) as { language: string } | undefined;
      const lang = doc?.language || "de";
      const rowStmt = db().prepare(
        `SELECT c.id, c.number, c.title, c.text, c.audio_text, a.stored_path FROM chapters c JOIN audio a ON a.chapter_id = c.id AND a.status = 'done' WHERE c.id = ?`
      );
      for (const id of chapterIds) {
        if (cancel) break;
        const ch = rowStmt.get(id) as { id: string; number: number; title: string | null; text: string; audio_text: string | null; stored_path: string } | undefined;
        if (!ch) {
          st.done++;
          continue;
        }
        st.current = ch.title ?? `Kapitel ${ch.number}`;
        // Nie zwei Dinge auf der Grafikkarte; der Arbiter regelt Gemma und Stimmen, Docling und Lernhörbuch hier
        while (!cancel && (anyProcessing() || anyGenerating() || learnUnitActive())) {
          st.waiting = true;
          await sleep(5000);
        }
        st.waiting = false;
        if (cancel) break;
        const file = fromDataPath(ch.stored_path);
        if (!existsSync(file)) {
          st.done++;
          continue;
        }
        const text = expectedText(ch, lang);
        const heard = await transcribe(file, lang);
        // Zahlen, Abkürzungen, Formelzeichen, Schreibvarianten: kein Aussprachefehler
        const findings = findIssues(text, heard.words).filter((f) => !isNoise(f));
        saveCheck(docId, ch.id, findings, tokens(text).length, heard.duration);
        st.found += findings.length;
        st.done++;
        console.log(`[proncheck] ${st.current}: ${findings.length} Befunde (${heard.words.length} Wörter gehört)`);
      }
    });
  } catch (err) {
    st.error = err instanceof Error ? err.message : String(err);
    emitLog("warn", "proncheck", "Ausspracheprüfung fehlgeschlagen", { err, ctx: { docId } });
  } finally {
    st.running = false;
    st.waiting = false;
    st.current = undefined;
  }
}
