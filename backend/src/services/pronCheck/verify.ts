// Wortprüfung: offene Einträge der Ausspracheliste mit der eigenen Stimme in einem Trägersatz sprechen, mit Whisper
// abhören und abgleichen. Hört Whisper das Originalwort, ist der Eintrag erledigt; sonst schlägt Gemma eine andere
// Schreibweise vor, bis zu drei Runden. Erst alle sprechen, dann alle abhören: wenige Wechsel auf der Grafikkarte.
// Entscheidet nur über „Erledigt“, nie über Löschen; was offen bleibt, trägt das Gehörte als Hinweis
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../../paths";
import { emitLog } from "../../log/logger";
import { defaultVoiceFor, findVoice } from "../../tts/voices";
import { synthesizeChunk } from "../../tts/synth";
import { concatMp3WithGaps } from "../../tts/ffmpeg/mp3";
import { isAbbreviation, pronunciationList, savePronunciation, type PronunciationEntry } from "../pronunciation";
import { retrySpelling } from "../pronunciationSuggest";
import { editDistance, findIssues, norm, type HeardWord } from "./align";
import { isNoise } from "./noise";
import { sttAvailable, transcribe } from "./stt";

export const ROUNDS = 3;
export const carrier = (spelling: string) => `Das Wort heißt: ${spelling}.`;

// Urteil: Der Abgleich des Trägersatzes mit dem Originalwort hat keinen Befund; dazu das gehörte Wort als Hinweis
export function judge(word: string, heard: HeardWord[]): { ok: boolean; heard: string } {
  const findings = findIssues(carrier(word), heard).filter((f) => !isNoise(f));
  const text = heard.map((w) => w.word).join(" ");
  const after = text.replace(/^[\s\S]*?hei(ß|ss)t[:,]?\s*/i, "");
  return { ok: findings.length === 0, heard: after.replace(/[\s.!?]+$/g, "").trim() };
}

export interface VerifyDeps {
  // Trägersatz sprechen, Datei zurück
  speak: (text: string, idx: number) => Promise<string>;
  hear: (file: string) => Promise<HeardWord[]>;
  // Neue Schreibweisen für Wörter, die nicht passten: from → to
  improve: (items: Array<{ from: string; tried: string[]; heard: string }>) => Promise<Map<string, string>>;
  // Andere Arbeit auf der Grafikkarte: vor der nächsten Runde aufhören
  busy?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface VerifyResult {
  checked: number;
  open: number;
  rounds: number;
}

interface Work extends PronunciationEntry {
  tried: string[];
  best: { to: string; heard: string; score: number };
}

// Reiner Ablauf mit eingesetzten Diensten, gut testbar. Gibt die ganze Liste mit Änderungen zurück
export async function verifyEntries(entries: PronunciationEntry[], deps: VerifyDeps, rounds = ROUNDS): Promise<{ entries: PronunciationEntry[]; result: VerifyResult }> {
  const work: Work[] = entries.map((e) => ({ ...e, tried: [e.to], best: { to: e.to, heard: "", score: Number.POSITIVE_INFINITY } }));
  let pending = work.filter((e) => !e.checked);
  const total = pending.length;
  let r = 0;
  for (; r < rounds && pending.length; r++) {
    if (deps.busy?.()) break;
    const files: string[] = [];
    for (const [i, e] of pending.entries()) files.push(await deps.speak(carrier(e.to), r * 1000 + i));
    for (const [i, e] of pending.entries()) {
      const j = judge(e.from, await deps.hear(files[i]));
      if (j.ok) {
        e.checked = true;
        delete e.heard;
      } else {
        const score = editDistance(norm(e.from), norm(j.heard));
        if (score < e.best.score) e.best = { to: e.to, heard: j.heard, score };
        e.heard = j.heard;
      }
    }
    deps.onProgress?.(total - work.filter((e) => !e.checked && pending.includes(e)).length, total);
    const failed = pending.filter((e) => !e.checked);
    if (!failed.length || r === rounds - 1) {
      r++;
      break;
    }
    const next = await deps.improve(failed.map((e) => ({ from: e.from, tried: e.tried, heard: e.heard ?? "" })));
    pending = [];
    for (const e of failed) {
      const to = next.get(e.from)?.trim();
      if (!to || e.tried.includes(to)) continue;
      e.to = to;
      e.tried.push(to);
      pending.push(e);
    }
  }
  // Nicht gelöst: die Schreibweise behalten, deren Abhörung dem Wort am nächsten kam, Gehörtes als Hinweis
  for (const e of work) {
    if (e.checked || e.best.score === Number.POSITIVE_INFINITY) continue;
    e.to = e.best.to;
    e.heard = e.best.heard;
  }
  const out = work.map(({ tried: _t, best: _b, ...e }) => e);
  const openNow = out.filter((e) => !e.checked).length;
  return { entries: out, result: { checked: entries.filter((e) => !e.checked).length - openNow, open: openNow, rounds: r } };
}

// Änderungen in die aktuelle Liste übernehmen: nur Einträge, die der Nutzer inzwischen nicht selbst geändert hat
export function mergeVerified(current: PronunciationEntry[], before: PronunciationEntry[], after: PronunciationEntry[]): PronunciationEntry[] {
  const started = new Map(before.map((e) => [e.from, e.to]));
  const result = new Map(after.map((e) => [e.from, e]));
  return current.map((e) => {
    const r = result.get(e.from);
    return r && started.get(e.from) === e.to && !e.checked ? { ...e, to: r.to, checked: r.checked, heard: r.heard } : e;
  });
}

// Englische Wörter in Lautschrift greifen bei Qwen nicht (es spricht das Original): dort nur Abkürzungen prüfen
export const appliesTo = (e: PronunciationEntry, engine: string | undefined) => engine !== "qwen" || isAbbreviation(e.from);

function defaultGermanVoice() {
  const voiceId = defaultVoiceFor("de");
  return voiceId ? findVoice(voiceId, "de") : undefined;
}

// Offene Einträge, die die deutsche Standardstimme wirklich nutzt
export function openEntries(): PronunciationEntry[] {
  const engine = defaultGermanVoice()?.engine;
  return pronunciationList().entries.filter((e) => !e.checked && appliesTo(e, engine));
}

// Offene Einträge mit der deutschen Standardstimme prüfen; null, wenn Whisper oder Stimme fehlen
export async function verifyOpenEntries(opts: { busy?: () => boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<VerifyResult | null> {
  if (!sttAvailable()) return null;
  const voice = defaultGermanVoice();
  if (!voice) return null;
  // Was die Stimme nicht nutzt, gilt für diesen Lauf als erledigt und bleibt in der Liste unverändert
  const all = pronunciationList().entries;
  const before = all.map((e) => (appliesTo(e, voice.engine) ? e : { ...e, checked: true }));
  if (!before.some((e) => !e.checked)) return { checked: 0, open: 0, rounds: 0 };
  const dir = join(DATA_DIR, "audio", "_wortpruefung");
  mkdirSync(dir, { recursive: true });
  const deps: VerifyDeps = {
    speak: async (text, idx) => {
      const raw = join(dir, `w${idx}.mp3`);
      await synthesizeChunk({ segment: { paragraphs: [text] }, text, voice, locale: voice.locale, rate: "+0%", outPath: raw });
      // Eine halbe Sekunde Stille davor und danach: Whisper schneidet sonst den Anfang an
      const padded = join(dir, `w${idx}-still.mp3`);
      await concatMp3WithGaps([raw], padded, { leadingMs: 500, trailingMs: 500 });
      return padded;
    },
    hear: async (file) => (await transcribe(file, "de")).words,
    improve: (items) => retrySpelling(items),
    busy: opts.busy,
    onProgress: opts.onProgress,
  };
  try {
    const { entries, result } = await verifyEntries(before, deps);
    const tested = entries.filter((_, i) => !before[i].checked);
    savePronunciation(mergeVerified(pronunciationList().entries, all, tested));
    const done = entries.filter((e, i) => e.checked && !before[i]?.checked).map((e) => `${e.from} → ${e.to}`);
    emitLog("info", "proncheck", `Wortprüfung: ${result.checked} erledigt, ${result.open} offen${done.length ? ` (${done.join(", ")})` : ""}`);
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
