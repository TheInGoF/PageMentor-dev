// Gemma lernt aus gelösten Befunden der Ausspracheprüfung, aber nur in die Ausspracheliste: Nur wenn der Nutzer den
// grünen Haken setzt, schlägt Gemma für das Wort eine Schreibweise zum Sprechen vor. Der Vorschlag kommt als offener
// (ungeprüfter) Eintrag in die Liste, zum Anhören und Abhaken. Der Hörbuch-Prompt bleibt unberührt
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../../db";
import { emitLog } from "../../log/logger";
import { getPrompt, savePrompt, type PromptId } from "../prompts";
import { anyProcessing } from "../pipeline";
import { anyGenerating } from "../audiobook";
import { learnUnitActive } from "../learnbook/run";
import { installedModels, isInstalled } from "../../engine/llmExtras";
import { pronunciationList, savePronunciation } from "../pronunciation";
import { suggestFor } from "../pronunciationSuggest";
import { getIssue } from "./store";

// Früher hängte die App gelernte Hinweise an den Hörbuch-Prompt; dieser Abschnitt wird einmalig wieder entfernt
export const LEARNED_HEADER = {
  de: "================================================================\n14. GELERNTE HINWEISE ZUR AUSSPRACHE (aus der Ausspracheprüfung)\n================================================================",
  en: "================================================================\n14. LEARNED PRONUNCIATION HINTS (from the pronunciation check)\n================================================================",
};

export function withoutLearnedSection(text: string): string {
  for (const h of Object.values(LEARNED_HEADER)) {
    const i = text.indexOf(h);
    if (i >= 0) return `${text.slice(0, i).replace(/\s+$/, "")}\n`;
  }
  return text;
}

export function removeLearnedSections(): void {
  for (const id of ["audio-chapter.de", "audio-chapter.en"] as PromptId[]) {
    const before = getPrompt(id);
    const after = withoutLearnedSection(before);
    if (after !== before) {
      savePrompt(id, after);
      emitLog("info", "proncheck", `Gelernte Hinweise aus dem Hörbuch-Prompt entfernt (${id}); Gemma lernt jetzt in die Ausspracheliste`);
    }
  }
}

// Wörter aus dem Befund, für die eine Aussprache sinnvoll ist: Buchstaben, mindestens drei
export function candidateWords(expected: string): string[] {
  return expected
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w.replace(/[^\p{L}]/gu, "").length >= 3)
    .slice(0, 3);
}

const queue: string[] = [];
let worker: Promise<void> | null = null;
let current: string | null = null;

export function learnQueue(): { pending: number; current: string | null } {
  return { pending: queue.length, current };
}

export function enqueueLearn(issueId: string): void {
  if (queue.includes(issueId) || current === issueId) return;
  queue.push(issueId);
  worker ??= drain().finally(() => (worker = null));
}

async function drain(): Promise<void> {
  for (let id = queue.shift(); id; id = queue.shift()) {
    current = id;
    try {
      await learnOne(id);
    } catch (err) {
      emitLog("warn", "proncheck", "Gemma konnte aus dem Befund nicht lernen", { err, ctx: { issueId: id } });
    } finally {
      current = null;
    }
  }
}

async function pickModel(): Promise<string | undefined> {
  const names = await installedModels();
  return names && isInstalled(names, "gemma4:26b") ? "gemma4:26b" : undefined;
}

async function learnOne(id: string): Promise<void> {
  const issue = getIssue(id);
  if (!issue || issue.status !== "resolved") return;
  const mark = (learned: string) => db().prepare("UPDATE pron_issues SET learned = ? WHERE id = ?").run(learned, id);
  // Schon von Hand übernommen („Wort → so gesprochen“): nichts weiter zu lernen
  if (issue.note?.includes("→")) return void mark(issue.note);
  const words = candidateWords(issue.expected);
  if (!words.length) return void mark("-");
  // Wie alle GPU-Arbeit: Umwandlung, Hörbuch und Lernhörbuch-Einheit gehen vor
  while (anyProcessing() || anyGenerating() || learnUnitActive()) await sleep(5000);
  // Gemma lässt deutsche Wörter weg und liefert nur, was noch nicht in der Liste steht
  const items = await suggestFor(words, await pickModel());
  if (!items.length) return void mark("-");
  const list = pronunciationList().entries;
  savePronunciation([...list, ...items.map((e) => ({ from: e.from, to: e.to }))]);
  const learned = items.map((e) => `${e.from} → ${e.to}`).join(", ");
  emitLog("info", "proncheck", `In die Ausspracheliste übernommen (ungeprüft): ${learned}`, { ctx: { issueId: id } });
  mark(learned);
}
