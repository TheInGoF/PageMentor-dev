// Lernhörbuch, Schritt Skript: Das Heft wird als fortlaufender Text gelesen (Doclings Kapitel liefern nur
// die Reihenfolge), in Lerneinheiten von einigen Minuten geteilt und je Einheit von einem großen Modell neu
// geschrieben. Frühere Merkpunkte kommen in wachsenden Abständen wieder (1, 3 und 7 Einheiten zurück).
// Fachhefte bekommen einen Prüfdurchgang gegen die Vorlage und werden bei Abweichungen korrigiert
import { createHash } from "node:crypto";
import { db } from "../../db";
import { generate } from "../llm";
import { getPrompt } from "../prompts";
import { getLlmConfig } from "../llmConfig";
import { DEFAULT_LLM_BUDGET, EXTRA_LLMS } from "../../engine/config";
import { installedModels, isInstalled } from "../../engine/llmExtras";
import type { LearnKind, LearnUnit } from "./store";

const VERSION = 1;
// Zielgröße einer Einheit in Zeichen Quelltext: Sprachbücher sind dicht (Vokabeln, Übungen), Fachtext ausführlicher
const UNIT_CHARS: Record<LearnKind, number> = { language: 4000, subject: 6000 };
// Kapitelarten ohne Lernwert fürs Hören
const SKIP_KINDS = new Set(["index", "references", "solutions", "self_check"]);
// Wiederholung in wachsenden Abständen
const REVIEW_BACK = [1, 3, 7];
const REVIEW_MAX = 8;

export const LANG_NAMES: Record<string, string> = { es: "Spanisch", en: "Englisch", fr: "Französisch", it: "Italienisch", pt: "Portugiesisch", de: "Deutsch" };

interface Para {
  text: string;
  page: number;
  heading: boolean;
}

// Heft als Strom aus Absätzen mit Seitenzahl; Überschriften bleiben als eigene Zeile für die Orientierung
function streamOf(docId: string): Para[] {
  const chapters = db()
    .prepare("SELECT title, kind, text, start_page, end_page FROM chapters WHERE document_id = ? ORDER BY sort_order, number")
    .all(docId) as Array<{ title: string; kind: string; text: string; start_page: number; end_page: number }>;
  const out: Para[] = [];
  for (const c of chapters) {
    if (SKIP_KINDS.has(c.kind) || (c.text ?? "").trim().length < 20) continue;
    if (c.title?.trim()) out.push({ text: c.title.trim(), page: c.start_page, heading: true });
    const paras = c.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    // Seiten grob über die Lage im Kapitel verteilen; genauer liefert es Docling hier nicht
    paras.forEach((p, i) => out.push({ text: p, page: c.start_page + Math.floor(((c.end_page - c.start_page + 1) * i) / Math.max(1, paras.length)), heading: false }));
  }
  return out;
}

// Einheiten bilden: bis zur Zielgröße sammeln, bevorzugt an einer Überschrift schließen, nie über das 1,6-fache
export function splitUnits(paras: Para[], target: number): Array<{ source: string; start_page: number; end_page: number }> {
  const units: Array<{ source: string; start_page: number; end_page: number }> = [];
  let cur: Para[] = [];
  let size = 0;
  const close = () => {
    if (!cur.length) return;
    units.push({ source: cur.map((p) => (p.heading ? `## ${p.text}` : p.text)).join("\n\n"), start_page: cur[0].page, end_page: cur[cur.length - 1].page });
    cur = [];
    size = 0;
  };
  for (const p of paras) {
    const atHeading = p.heading && size >= target * 0.6;
    if (cur.length && (atHeading || size + p.text.length > target * 1.6 || (size >= target && !cur[cur.length - 1].heading))) close();
    cur.push(p);
    size += p.text.length;
  }
  close();
  // Ein kleiner Rest am Ende gehört zur vorigen Einheit
  if (units.length > 1 && units[units.length - 1].source.length < target * 0.3) {
    const last = units.pop()!;
    const prev = units[units.length - 1];
    prev.source += `\n\n${last.source}`;
    prev.end_page = last.end_page;
  }
  return units;
}

export function unitsFor(docId: string, kind: LearnKind) {
  return splitUnits(streamOf(docId), UNIT_CHARS[kind]);
}

// Merkpunkte früherer Einheiten in wachsenden Abständen (1, 3, 7 zurück)
export function reviewPoints(units: LearnUnit[], idx: number): string[] {
  const out: string[] = [];
  for (const back of REVIEW_BACK) {
    const u = units.find((x) => x.idx === idx - back);
    if (!u?.points) continue;
    try {
      for (const p of JSON.parse(u.points) as string[]) if (!out.includes(p)) out.push(p);
    } catch {
      /* kaputte Liste überspringen */
    }
  }
  return out.slice(0, REVIEW_MAX);
}

// Modell je Art: Wahl in den Einstellungen, sonst Gemma 26B für Sprachen und Qwen 3.6 für Fachhefte, wenn geladen
export async function learnModel(kind: LearnKind): Promise<{ model?: string; ctx: number }> {
  const cfg = getLlmConfig();
  const chosen = kind === "language" ? cfg.learnModelLanguage : cfg.learnModelSubject;
  const prefs = chosen ? [chosen] : kind === "language" ? ["gemma4:26b"] : ["qwen3.6:27b", "gemma4:26b"];
  const installed = (await installedModels()) ?? [];
  for (const m of prefs) if (m in EXTRA_LLMS && isInstalled(installed, m)) return { model: m, ctx: EXTRA_LLMS[m].ctx };
  return { ctx: Math.min(DEFAULT_LLM_BUDGET.ctx, 32768) };
}

const SCRIPT_SCHEMA = {
  type: "object",
  properties: { titel: { type: "string" }, skript: { type: "string" }, merkpunkte: { type: "array", items: { type: "string" } } },
  required: ["titel", "skript", "merkpunkte"],
};
const CHECK_SCHEMA = {
  type: "object",
  properties: {
    abweichungen: {
      type: "array",
      items: { type: "object", properties: { stelle: { type: "string" }, problem: { type: "string" }, korrektur: { type: "string" } }, required: ["stelle", "problem", "korrektur"] },
    },
  },
  required: ["abweichungen"],
};

function parseJson<T>(raw: string): T | null {
  try {
    const a = raw.indexOf("{");
    return JSON.parse(a >= 0 ? raw.slice(a, raw.lastIndexOf("}") + 1) : raw) as T;
  } catch {
    return null;
  }
}

export function scriptStamp(kind: LearnKind, lang: string, model: string, source: string, review: string[]): string {
  const prompts = getPrompt(kind === "language" ? "learn-language.de" : "learn-subject.de") + (kind === "subject" ? getPrompt("learn-check.de") : "");
  return createHash("sha1").update(`${VERSION}|${kind}|${lang}|${model}|${prompts}|${source}|${review.join("\n")}`).digest("hex").slice(0, 16);
}

export interface WrittenUnit {
  title: string;
  script: string;
  points: string[];
  checkNote: string | null;
}

// Eine Einheit schreiben (und bei Fachheften prüfen und korrigieren). Der Aufrufer sorgt für die Gemma-Sperre
export async function writeUnit(p: {
  kind: LearnKind;
  lang: string;
  docTitle: string;
  idx: number;
  total: number;
  unit: Pick<LearnUnit, "source" | "start_page" | "end_page">;
  review: string[];
  model?: string;
  ctx: number;
}): Promise<WrittenUnit> {
  const system = getPrompt(p.kind === "language" ? "learn-language.de" : "learn-subject.de");
  const think = p.model?.startsWith("qwen") ? false : undefined;
  const options = { temperature: 0.4, num_ctx: p.ctx, num_predict: 6000 };
  const head = [
    `Einheit ${p.idx + 1} von ${p.total} · Heft „${p.docTitle}“ · Seiten ${p.unit.start_page}–${p.unit.end_page}`,
    p.kind === "language" ? `Fremdsprache: ${LANG_NAMES[p.lang] ?? p.lang}, Markierung [${p.lang}]…[/${p.lang}]` : "",
    p.review.length ? `Bisher gelernt (zur Wiederholung, nur wenn es passt):\n${p.review.map((r) => `- ${r}`).join("\n")}` : "Bisher gelernt: noch nichts, das ist die erste Einheit.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const prompt = `${head}\n\nVorlage:\n\n${p.unit.source}`;

  const write = async (extra = "") => {
    const r = await generate({ prompt: prompt + extra, system, model: p.model, think, format: SCRIPT_SCHEMA, options });
    const j = parseJson<{ titel?: string; skript?: string; merkpunkte?: string[] }>(r.response);
    if (!j?.skript || j.skript.trim().length < 200) throw new Error(`Skript zu kurz oder unlesbar (${r.response.length} Zeichen, ${r.doneReason ?? "?"})`);
    return { title: (j.titel ?? "").trim() || `Einheit ${p.idx + 1}`, script: j.skript.trim(), points: (j.merkpunkte ?? []).filter((x) => typeof x === "string").slice(0, 8) };
  };

  let out = await write();
  let checkNote: string | null = null;
  if (p.kind === "subject") {
    // Prüfdurchgang: fachliche Abweichungen von der Vorlage finden und, wenn nötig, gezielt korrigieren lassen
    const c = await generate({
      prompt: `Vorlage:\n\n${p.unit.source}\n\nSkript:\n\n${out.script}`,
      system: getPrompt("learn-check.de"),
      model: p.model,
      think,
      format: CHECK_SCHEMA,
      options: { temperature: 0.1, num_ctx: p.ctx, num_predict: 2000 },
    }).catch(() => null);
    const issues = (c && parseJson<{ abweichungen?: Array<{ stelle: string; problem: string; korrektur: string }> }>(c.response)?.abweichungen) ?? [];
    if (!c) checkNote = "Prüfung nicht möglich";
    else if (!issues.length) checkNote = "geprüft, keine Abweichung";
    else {
      const list = issues.map((i) => `- „${i.stelle}“: ${i.problem} → ${i.korrektur}`).join("\n");
      try {
        out = await write(`\n\nDein erster Entwurf hatte diese fachlichen Fehler. Schreibe das Skript neu und korrigiere genau diese Stellen:\n${list}`);
        checkNote = `${issues.length} Abweichung(en) gefunden und korrigiert:\n${list}`;
      } catch {
        checkNote = `${issues.length} Abweichung(en) gefunden, Korrektur fehlgeschlagen:\n${list}`;
      }
    }
  }
  return { ...out, checkNote };
}
