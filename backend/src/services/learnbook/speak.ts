// Lernhörbuch, Schritt Sprache: Skript in Sprechstücke und Pausen zerlegen, Deutsch und Fremdsprache mit
// eigener Stimme, echte Stille für [PAUSE n], [langsam]…[/langsam] gebremst, je Einheit eine MP3, am Ende ein M4B
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { db } from "../../db";
import { AUDIOBOOK_EXPORT_DIR, DATA_DIR } from "../../paths";
import { segmentText } from "../../tts/segment";
import { maxChunkFor, synthesizeChunk } from "../../tts/synth";
import { buildM4B, concatMp3, normalizeAndTag, run } from "../../tts/ffmpeg";
import { probeSampleRate } from "../../tts/ffmpeg/mp3";
import type { Voice } from "../../tts/engines/base";
import { applyPronunciation } from "../pronunciation";
import { fixGermanNumeralBleed } from "../audioPreprocess/numerals";
import { ensureSentenceEnd, splitLanguageRuns } from "../audiobook/synthChapter";
import { coverPathFor } from "../audiobook/files";
import { bookFileName } from "../audiobook/export";
import { learnSettings, listUnits } from "./store";
import { learnAuthor, learnFileSuffix, learnTitle } from "./meta";

export type ScriptPart = { kind: "speech"; lang: string | null; text: string; slow?: boolean } | { kind: "pause"; ms: number };

// Langsame Fassung: Tempo der Stücke in [langsam]…[/langsam], die Tonhöhe bleibt
export const SLOW_TEMPO = 0.8;

// Pausen zwischen Sprechstücken: kurz innerhalb einer Sprache, etwas länger beim Wechsel
const GAP_MS = 250;
const SWITCH_MS = 450;

// "[PAUSE 4]" wird zu vier Sekunden Stille (0,5 bis 10 s), [es]…[/es] zur zweiten Stimme, [langsam]…[/langsam]
// (auch über Pausen hinweg) zu gebremsten Stücken
export function parseScript(script: string): ScriptPart[] {
  const parts: ScriptPart[] = [];
  // Das Modell setzt [langsam] manchmal innerhalb der Sprachmarkierung: nach außen ziehen
  const text = script.replace(/\[([a-z]{2})\]\s*\[langsam\]/gi, "[langsam][$1]").replace(/\[\/langsam\]\s*\[\/([a-z]{2})\]/gi, "[/$1][/langsam]");
  const re = /\[PAUSE\s+(\d+(?:[.,]\d+)?)\s*s?\]|\[(\/?)langsam\]/gi;
  let last = 0;
  let slow = false;
  const speech = (t: string) => {
    for (const r of splitLanguageRuns(t)) parts.push({ kind: "speech", lang: r.lang, text: r.text.trim(), ...(slow ? { slow: true } : {}) });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    speech(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const sec = Math.min(10, Math.max(0.5, parseFloat(m[1].replace(",", "."))));
      parts.push({ kind: "pause", ms: Math.round(sec * 1000) });
    } else slow = m[2] !== "/";
    last = m.index + m[0].length;
  }
  speech(text.slice(last));
  return thinkTime(parts);
}

// Denkzeit: Die Pause zwischen einer Frage an den Hörer und ihrer Antwort („Antwort: …“) dauert mindestens
// sechs Sekunden. Rhetorische Fragen im Fließtext haben keine eigene Pause und bleiben, wie sie sind
export const THINK_MS = 6000;
export function thinkTime(parts: ScriptPart[]): ScriptPart[] {
  return parts.map((p, i) => {
    if (p.kind !== "pause" || p.ms >= THINK_MS) return p;
    const prev = parts[i - 1];
    const next = parts[i + 1];
    const question = prev?.kind === "speech" && /\?$/.test(prev.text);
    const answer = next?.kind === "speech" && /^Antwort\b/i.test(next.text);
    return question && answer ? { kind: "pause", ms: THINK_MS } : p;
  });
}

export function audioStamp(script: string, voices: Voice[], rate: string): string {
  return createHash("sha1").update(`${script}|${voices.map((v) => v.id).join("+")}|${rate}`).digest("hex").slice(0, 16);
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

// Langsame Fassung eines Stücks: Tempo auf 80 %, Tonhöhe bleibt (atempo); liegt neben dem Original
async function slowed(file: string): Promise<string> {
  const out = join(resolve(file, ".."), `${basename(file, ".mp3")}-slow.mp3`);
  if (!existsSync(out) || statSync(out).size === 0) {
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-filter:a", `atempo=${SLOW_TEMPO}`, "-c:a", "libmp3lame", "-b:a", "96k", out]);
  }
  return out;
}

// Stille mit der Abtastrate der Stimme: die Stücke werden ohne Neukodierung aneinandergehängt
async function silence(dir: string, ms: number, sr: number): Promise<string> {
  const p = join(dir, `silence-${sr}-${ms}.mp3`);
  if (!existsSync(p)) {
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `anullsrc=r=${sr}:cl=mono`, "-t", (ms / 1000).toFixed(3), "-c:a", "libmp3lame", "-b:a", "96k", p]);
  }
  return p;
}

// Eine Einheit sprechen; fertige Sprechstücke liegen zwischen und werden bei einem neuen Versuch übersprungen
export async function speakUnit(p: {
  docId: string;
  idx: number;
  title: string;
  album: string;
  script: string;
  main: Voice;
  second: Voice | null;
  rate: string;
  isCanceled: () => boolean;
  // Fortschritt innerhalb der Einheit: gesprochene Stücke von allen
  onProgress?: (done: number, total: number) => void;
}): Promise<{ path: string; durationMs: number }> {
  // Absolute Pfade: ffmpeg löst Einträge der Verkettungsliste sonst relativ zur Liste auf
  const dir = resolve(DATA_DIR, "audio", p.docId, "learn", `unit-${String(p.idx + 1).padStart(3, "0")}`);
  mkdirSync(dir, { recursive: true });
  // Erst sprechen, dann zusammensetzen: so steht die Abtastrate für die Stille fest
  const plan: Array<{ pause: number } | { file: string }> = [];
  let prevLang: string | null | undefined;
  const parts = parseScript(p.script);
  const speech = parts.filter((x) => x.kind === "speech").length;
  let spoken = 0;
  p.onProgress?.(0, speech);
  for (const part of parts) {
    if (p.isCanceled()) throw new Error("abgebrochen");
    if (part.kind === "pause") {
      plan.push({ pause: part.ms });
      prevLang = undefined;
      continue;
    }
    const voice = part.lang && p.second ? p.second : p.main;
    const german = voice.locale.startsWith("de");
    if (prevLang !== undefined) plan.push({ pause: prevLang === part.lang ? GAP_MS : SWITCH_MS });
    for (const seg of segmentText(part.text, maxChunkFor(voice.engine))) {
      // Deutsch: Zahlwort-Brei des Modells reparieren (wie beim Original-Hörbuch), dann Ausspracheliste
      const text = ensureSentenceEnd(seg.paragraphs.map((t) => (german ? applyPronunciation(fixGermanNumeralBleed(t).text) : t)).join("\n\n"));
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      const out = join(dir, `${hash(`${text}|${voice.id}|${p.rate}`)}.mp3`);
      if (!existsSync(out) || statSync(out).size === 0) {
        await synthesizeChunk({ segment: { paragraphs: [text] }, text, voice, locale: voice.locale, rate: p.rate, outPath: out });
      }
      plan.push({ file: part.slow ? await slowed(out) : out });
    }
    prevLang = part.lang;
    p.onProgress?.(++spoken, speech);
  }
  const files = plan.filter((x): x is { file: string } => "file" in x);
  if (!files.length) throw new Error("Skript ohne Sprechtext");
  const sr = (await probeSampleRate(files[0].file)) ?? 24000;
  const seq = [await silence(dir, 800, sr)];
  for (const x of plan) seq.push("file" in x ? x.file : await silence(dir, x.pause, sr));
  seq.push(await silence(dir, 1500, sr));
  const merged = join(dir, "merged.mp3");
  await concatMp3(seq, merged);
  const path = resolve(DATA_DIR, "audio", p.docId, "learn", `unit-${String(p.idx + 1).padStart(3, "0")}.mp3`);
  const { durationMs } = await normalizeAndTag({ input: merged, output: path, title: p.title, album: p.album, trackNumber: p.idx + 1, coverPath: coverPathFor(p.docId) });
  return { path, durationMs };
}

export function learnBookPath(docId: string): string {
  return resolve(DATA_DIR, "audio", docId, "learn.m4b");
}

// Intro als eigene Datei neben den Einheiten
export function learnIntroPath(docId: string): string {
  return resolve(DATA_DIR, "audio", docId, "learn", "intro.mp3");
}

// Alle Einheiten mit Audio zu einem M4B mit Kapiteln (Intro vorneweg, wenn da); Kopie in den Hörbücher-Ordner,
// neben dem normalen Hörbuch. Titel und Autor mit Zusatz, damit es vom Original unterscheidbar ist
export async function buildLearnBook(docId: string, intro?: { path: string; durationMs: number } | null): Promise<string> {
  // Übersprungene Einheiten (kein Inhalt) gehören nicht hinein
  const units = listUnits(docId).filter((u) => u.script && !u.skip_reason);
  if (!units.length || units.some((u) => !u.audio_path || !existsSync(u.audio_path))) throw new Error("Nicht alle Einheiten haben schon Audio");
  const doc = db()
    .prepare("SELECT d.title, d.doc_title, d.author, d.short_code, m.name AS module_name FROM documents d LEFT JOIN modules m ON m.id = d.module_id WHERE d.id = ?")
    .get(docId) as { title: string; doc_title: string | null; author: string | null; short_code: string | null; module_name: string | null };
  const { kind } = learnSettings(docId);
  const out = learnBookPath(docId);
  const withIntro = intro && existsSync(intro.path) ? intro : null;
  await buildM4B({
    inputs: [...(withIntro ? [withIntro.path] : []), ...units.map((u) => u.audio_path!)],
    chapters: [
      ...(withIntro ? [{ title: "Einleitung", durationMs: withIntro.durationMs }] : []),
      ...units.map((u) => ({ title: u.title ?? `Einheit ${u.idx + 1}`, durationMs: u.duration_ms ?? 0 })),
    ],
    output: out,
    title: learnTitle(doc.doc_title || doc.title, kind),
    artist: learnAuthor(doc.author),
    shortCode: doc.short_code ?? undefined,
    series: doc.module_name ?? undefined,
    coverPath: coverPathFor(docId),
  });
  mkdirSync(AUDIOBOOK_EXPORT_DIR, { recursive: true });
  const dest = join(AUDIOBOOK_EXPORT_DIR, bookFileName(docId).replace(/\.m4b$/i, `${learnFileSuffix(kind)}.m4b`));
  copyFileSync(out, dest);
  return dest;
}
