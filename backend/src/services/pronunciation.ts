// Aussprache-Liste für deutsche Stimmen: Wort → so, wie es gesprochen werden soll (z. B. Anglizismen).
// Greift direkt vor der Sprachausgabe, unabhängig von Gemma, darum verlässlich. Standardeinträge
// kommen mit der App; die eigene Liste liegt im Datenordner und lässt sich auf den Standard zurücksetzen.
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "../paths";

export interface PronunciationEntry {
  from: string;
  to: string;
  // Angehört und für gut befunden; geprüfte Einträge lernt Gemma als Beispiele
  checked?: boolean;
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
  const clean = entries.map((e) => ({ from: e.from.trim(), to: e.to.trim(), ...(e.checked ? { checked: true } : {}) })).filter((e) => e.from && e.to);
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

// Längere Einträge zuerst ("Qwen3-TTS" vor "Qwen"); ganze Wörter, Groß-/Kleinschreibung egal
export function applyPronunciation(text: string, list: PronunciationEntry[] = entries()): string {
  const sorted = [...list].sort((a, b) => b.from.length - a.from.length);
  let out = text;
  for (const e of sorted) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(e.from)}(?![\\p{L}\\p{N}])`, "giu"), e.to);
  }
  return out;
}

// Geprüfte Einträge als Beispiele für Gemma: so lernt sie, wie neue Wörter für die Stimme zu schreiben sind
export function checkedExamples(): PronunciationEntry[] {
  return pronunciationList().entries.filter((e) => e.checked);
}

export function examplesBlock(): string {
  const ex = checkedExamples();
  if (!ex.length) return "";
  return `GEPRÜFTE AUSSPRACHE-BEISPIELE (vom Nutzer angehört, so klingt es mit seiner Stimme richtig; wende dasselbe Muster auf ähnliche Wörter an):\n${ex.map((e) => `  "${e.from}" → "${e.to}"`).join("\n")}`;
}
