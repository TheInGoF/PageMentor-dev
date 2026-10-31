// Gemma lernt aus gelösten Befunden der Ausspracheprüfung: Nur wenn der Nutzer den grünen Haken setzt, leitet
// Gemma (wenn geladen das große Modell) einen allgemeinen Hinweis ab. Der Code hängt ihn an den Hörbuch-Prompt an;
// bestehender Text wird nie geändert oder gelöscht. Aufräumen geht von Hand unter KI → Prompts, „Original“ setzt zurück
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../../db";
import { emitLog } from "../../log/logger";
import { generate } from "../llm";
import { withGemmaLock } from "../gemmaLock";
import { getPrompt, savePrompt, type PromptId } from "../prompts";
import { anyProcessing } from "../pipeline";
import { anyGenerating } from "../audiobook";
import { learnUnitActive } from "../learnbook/run";
import { installedModels, isInstalled } from "../../engine/llmExtras";
import { getIssue } from "./store";

export const LEARNED_HEADER = {
  de: "================================================================\n14. GELERNTE HINWEISE ZUR AUSSPRACHE (aus der Ausspracheprüfung)\n================================================================",
  en: "================================================================\n14. LEARNED PRONUNCIATION HINTS (from the pronunciation check)\n================================================================",
};

const SCHEMA = {
  type: "object",
  properties: { neu: { type: "boolean" }, regel: { type: "string" } },
  required: ["neu", "regel"],
};

const normRule = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Gelernte Hinweise im Prompt (Zeilen unter der Überschrift)
export function learnedRules(text: string, lang: "de" | "en"): string[] {
  const i = text.indexOf(LEARNED_HEADER[lang]);
  if (i < 0) return [];
  return text
    .slice(i + LEARNED_HEADER[lang].length)
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}

// Nur anhängen: der bisherige Text bleibt Zeichen für Zeichen erhalten. Doppelte Hinweise kommen nicht dazu
export function appendRule(text: string, rule: string, lang: "de" | "en"): string {
  const clean = rule.replace(/\s+/g, " ").trim().slice(0, 240);
  if (clean.length < 10) return text;
  if (learnedRules(text, lang).some((r) => normRule(r) === normRule(clean))) return text;
  const base = text.replace(/\s+$/, "");
  const head = text.includes(LEARNED_HEADER[lang]) ? "" : `\n\n${LEARNED_HEADER[lang]}`;
  return `${base}${head}\n- ${clean}\n`;
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
  // Wie alle GPU-Arbeit: Umwandlung, Hörbuch und Lernhörbuch-Einheit gehen vor
  while (anyProcessing() || anyGenerating() || learnUnitActive()) await sleep(5000);
  const doc = db().prepare("SELECT language FROM documents WHERE id = ?").get(issue.document_id) as { language: string } | undefined;
  const lang: "de" | "en" = doc?.language?.startsWith("en") ? "en" : "de";
  const promptId: PromptId = lang === "de" ? "audio-chapter.de" : "audio-chapter.en";
  const existing = learnedRules(getPrompt(promptId), lang);
  const finding = [
    `Art: ${issue.kind}`,
    `Soll laut Text: „${issue.expected}“`,
    `Gehört (Whisper): „${issue.heard}“`,
    `Zusammenhang: … ${issue.context} …`,
    issue.note ? `Lösung des Nutzers: ${issue.note}` : "Der Nutzer hat die Stelle ohne eigene Notiz als gelöst abgehakt.",
  ].join("\n");
  const prompt = `Befund:\n${finding}\n\nBestehende Hinweise:\n${existing.length ? existing.map((r) => `- ${r}`).join("\n") : "(noch keine)"}`;
  const model = await pickModel();
  const r = await withGemmaLock("pron-learn", () =>
    generate({ prompt, system: getPrompt("pron-learn.de"), model, format: SCHEMA, options: { temperature: 0.2, num_ctx: 8192, num_predict: 400 } })
  );
  let out: { neu?: boolean; regel?: string } = {};
  try {
    const a = r.response.indexOf("{");
    out = JSON.parse(a >= 0 ? r.response.slice(a, r.response.lastIndexOf("}") + 1) : r.response);
  } catch {
    out = {};
  }
  const rule = out.neu && typeof out.regel === "string" ? out.regel.trim() : "";
  const before = getPrompt(promptId);
  const after = rule ? appendRule(before, rule, lang) : before;
  const learned = after !== before ? rule : "";
  if (learned) {
    savePrompt(promptId, after);
    emitLog("info", "proncheck", `Gemma hat gelernt: ${learned}`, { ctx: { issueId: id, model: model ?? "Standard" } });
  }
  db().prepare("UPDATE pron_issues SET learned = ? WHERE id = ?").run(learned || "-", id);
}
