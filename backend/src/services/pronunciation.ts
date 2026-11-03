// Aussprache-Liste für deutsche Stimmen: Wort → so, wie es gesprochen werden soll (z. B. Anglizismen).
// Greift direkt vor der Sprachausgabe, unabhängig von Gemma, darum verlässlich. Standardeinträge
// kommen mit der App; die eigene Liste liegt im Datenordner und lässt sich auf den Standard zurücksetzen.
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "../paths";
import { verbalizeNumbers } from "./audioPreprocess/spokenNumbers";

export interface PronunciationEntry {
  from: string;
  to: string;
  // Angehört und für gut befunden; geprüfte Einträge lernt Gemma als Beispiele
  checked?: boolean;
  // Wortprüfung: was Whisper zuletzt gehört hat, solange der Eintrag offen ist
  heard?: string;
}

export const DEFAULT_PRONUNCIATION: PronunciationEntry[] = [
  { from: "PageMentor", to: "Pejdsch-Mentor" },
  { from: "F5-TTS", to: "Eff fünf Teh Teh Ess" },
  { from: "Qwen3-TTS", to: "Kwenn drei Teh Teh Ess" },
  { from: "Qwen", to: "Kwenn" },
  { from: "Gemma", to: "Dschemma" },
  { from: "Audiobookshelf", to: "Odio-Buck-Schelf" },
  { from: "Docling", to: "Dockling" },
  { from: "Workflow", to: "Wörkflou" },
  { from: "Feedback", to: "Fiedbäck" },
  { from: "Software", to: "Softwär" },
  { from: "Hardware", to: "Hardwär" },
  { from: "Update", to: "Apdejt" },
  { from: "Download", to: "Daunlohd" },
  { from: "Upload", to: "Aplohd" },
  { from: "Interface", to: "Interfejs" },
  { from: "Design", to: "Disain" },
  { from: "Team", to: "Tiem" },
  { from: "Meeting", to: "Mieting" },
];

const FILE = join(DATA_DIR, "pronunciation.json");
let cache: { mtime: number; entries: PronunciationEntry[] } | null = null;

export function pronunciationList(): { entries: PronunciationEntry[]; custom: boolean } {
  if (!existsSync(FILE)) return { entries: DEFAULT_PRONUNCIATION, custom: false };
  try {
    return { entries: JSON.parse(readFileSync(FILE, "utf8")) as PronunciationEntry[], custom: true };
  } catch {
    return { entries: DEFAULT_PRONUNCIATION, custom: false };
  }
}

export function savePronunciation(entries: PronunciationEntry[]): void {
  const clean = entries.map((e) => ({ from: e.from.trim(), to: e.to.trim(), ...(e.checked ? { checked: true } : {}), ...(!e.checked && e.heard ? { heard: e.heard } : {}) })).filter((e) => e.from && e.to);
  writeFileSync(FILE, JSON.stringify(clean, null, 2));
  cache = null;
}

export function resetPronunciation(): void {
  rmSync(FILE, { force: true });
  cache = null;
}

function entries(): PronunciationEntry[] {
  let mtime = 0;
  try {
    mtime = existsSync(FILE) ? Bun.file(FILE).lastModified : 0;
  } catch {
    mtime = 0;
  }
  if (!cache || cache.mtime !== mtime) cache = { mtime, entries: pronunciationList().entries };
  return cache.entries;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Längere Einträge zuerst ("Qwen3-TTS" vor "Qwen"); ganze Wörter, Groß-/Kleinschreibung egal.
// Qwen spricht Englisch richtig und Lautschrift wie "Pejdsch-Mentor" deutsch: dort bleiben englische Wörter und
// Namen im Original, und was Gemma schon in Lautschrift geschrieben hat, wird zurückgedreht. Abkürzungen gelten für alle.
// Danach große Zahlen und Kommazahlen in Worte: an "0,318" oder "1.250.000" scheitern die Stimmen
export function applyPronunciation(text: string, list: PronunciationEntry[] = entries(), engine?: string): string {
  const english = engine === "qwen";
  const pairs = list.map((e) => (english && !isAbbreviation(e.from) ? { from: e.to, to: e.from } : e)).sort((a, b) => b.from.length - a.from.length);
  let out = text;
  for (const e of pairs) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(e.from)}(?![\\p{L}\\p{N}])`, "giu"), e.to);
  }
  return verbalizeNumbers(out);
}

// Geprüfte Einträge als Beispiele für Gemma: so lernt sie, wie neue Wörter für die Stimme zu schreiben sind
export function checkedExamples(): PronunciationEntry[] {
  return pronunciationList().entries.filter((e) => e.checked);
}

// Abkürzung: zwei Großbuchstaben am Stück oder Ziffern im Wort ("TTS", "F5-TTS", "USB-C")
export function isAbbreviation(word: string): boolean {
  return /[A-ZÄÖÜ]{2,}/.test(word) || /\d/.test(word);
}

// Nach Art gruppiert und mit benanntem Schema: So überträgt Gemma die Tendenz auf Wörter, die nicht in der Liste stehen
export function examplesBlock(list: PronunciationEntry[] = checkedExamples()): string {
  if (!list.length) return "";
  const abbr = list.filter((e) => isAbbreviation(e.from));
  const words = list.filter((e) => !isAbbreviation(e.from));
  const lines = (es: PronunciationEntry[]) => es.map((e) => `  "${e.from}" → "${e.to}"`).join("\n");
  const parts = ["GEPRÜFTE AUSSPRACHE-BEISPIELE (vom Nutzer angehört, so klingt es mit seiner Stimme richtig). Schreibe diese Wörter genau so und wende dasselbe Schema auf alle ähnlichen Wörter an, auch wenn sie hier nicht stehen:"];
  if (abbr.length) parts.push(`Abkürzungen, Buchstaben deutsch benannt, Ziffern als Zahlwort:\n${lines(abbr)}`);
  if (words.length) parts.push(`Englische Wörter und Namen in deutscher Lautschrift, längere mit Bindestrich je Silbe:\n${lines(words)}`);
  return parts.join("\n");
}
