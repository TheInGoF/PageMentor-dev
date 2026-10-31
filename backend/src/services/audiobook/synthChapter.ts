// Ein Kapitel in Chunks synthetisieren und zu einer MP3 zusammenfügen
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { segmentText } from "../../tts/segment";
import { applyPronunciation } from "../pronunciation";
import { synthesizeChunk, interChunkPause, maxChunkFor } from "../../tts/synth";
import { concatMp3WithGaps, normalizeAndTag } from "../../tts/ffmpeg";
import type { Voice } from "../../tts/engines/base";
import { AudiobookCanceled, type Chapter } from "./state";
import { chunkHash, coverPathFor, documentTitle } from "./files";

// Text mit . ! ? abschließen
// Ohne Punkt spricht Qwen das letzte Wort abgehackt
function ensureSentenceEnd(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length === 0) return text;
  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar === "." || lastChar === "!" || lastChar === "?") return text;
  // Punkt vor dem Leerraum am Ende einfügen
  const trailingWs = text.slice(trimmed.length);
  return trimmed + "." + trailingWs;
}

// "[es]Me llamo[/es] bedeutet: ich heiße." → Abschnitte mit Sprache (null = Hauptsprache)
export function splitLanguageRuns(text: string): Array<{ lang: string | null; text: string }> {
  const runs: Array<{ lang: string | null; text: string }> = [];
  const re = /\[([a-z]{2})\]([\s\S]*?)\[\/\1\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) runs.push({ lang: null, text: text.slice(last, m.index) });
    runs.push({ lang: m[1], text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ lang: null, text: text.slice(last) });
  return runs.filter((r) => /[\p{L}\p{N}]/u.test(r.text));
}

export async function synthesizeChapter(params: {
  chapter: Chapter;
  audioDir: string;
  voice: Voice;
  locale: string;
  rate: string;
  outFile: string;
  signal: AbortSignal;
  onChunk: (current: number, total: number) => void;
  // Intro: jede Zeile ein eigener Abschnitt mit Pause dazwischen, Stille davor
  intro?: boolean;
  // Zweisprachige Bücher: Stimme je markierter Sprache ([es]…[/es]), z. B. { es: Dora }
  voices?: Record<string, Voice>;
}): Promise<{ durationMs: number }> {
  const { chapter, audioDir, voice, locale, rate, outFile, signal } = params;

  if (!chapter.text || chapter.text.trim().length < 20) {
    throw new Error("Chapter text is too short or empty.");
  }

  // Tmp-Ordner pro Kapitel: bleibt bei Fehler, Retry nutzt fertige Chunks
  const tmpDir = join(audioDir, `.tmp-${chapter.id}`);
  mkdirSync(tmpDir, { recursive: true });

  let success = false;
  try {
    // Deutsche Stimmen: Aussprache-Liste (Anglizismen, Produktnamen) direkt vor der Sprachausgabe
    const speakFor = (v: Voice) => (v.locale.startsWith("de") ? (t: string) => applyPronunciation(t) : (t: string) => t);
    const speak = speakFor(voice);
    const maxChunk = maxChunkFor(voice.engine);
    // Abschnitte samt Stimme: Fremdsprachige Passagen gehen an die Stimme ihrer Sprache
    let segments: Array<{ paragraphs: string[]; voice: Voice }>;
    if (params.intro) {
      // F5 und Co. sprechen Zeilenumbrüche nicht als Pause: im Intro darum Zeile für Zeile
      segments = chapter.text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => ({ paragraphs: [speak(l)], voice }));
    } else if (params.voices && Object.keys(params.voices).length) {
      segments = splitLanguageRuns(chapter.text).flatMap((run) => {
        const v = (run.lang && params.voices![run.lang]) || voice;
        if (v === voice) return segmentText(run.text, maxChunk).map((seg) => ({ paragraphs: seg.paragraphs.map(speak), voice }));
        // Fremdsprache ohne Aussprache-Liste, aber in Stücken, die ihre Stimme verträgt (F5: 250 Zeichen)
        return segmentText(run.text, maxChunkFor(v.engine)).map((seg) => ({ paragraphs: seg.paragraphs, voice: v }));
      });
      // Kapitelansage immer mit der Hauptstimme
      if (segments.length && segments[0].voice !== voice) segments.unshift({ paragraphs: [], voice });
    } else {
      segments = segmentText(chapter.text, maxChunk).map((seg) => ({ paragraphs: seg.paragraphs.map(speak), voice }));
    }
    // Gesamtzahl sofort melden
    params.onChunk(0, segments.length);

    const isDe = params.voice.locale.startsWith("de");
    const bookStart = Date.now();

    const chunkFiles: string[] = [];
    let skippedCount = 0;
    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted) throw new AudiobookCanceled();
      const explicitTitle = chapter.title?.trim() ? speak(chapter.title.trim()) : undefined;
      let announcement: string | undefined;
      if (i === 0) {
        if (explicitTitle) {
          announcement = isDe
            ? `Kapitel: ${explicitTitle}`
            : `Chapter: ${explicitTitle}`;
        } else if (chapter.number > 0) {
          announcement = isDe
            ? `Kapitel ${chapter.number}`
            : `Chapter ${chapter.number}`;
        }
      }
      const segVoice = segments[i].voice;
      // Leerer Platzhalter ohne Ansage (Kapitel 0 ohne Titel): nichts zu sprechen
      if (!announcement && !segments[i].paragraphs.length) {
        params.onChunk(i + 1, segments.length);
        continue;
      }
      const paragraphText = segments[i].paragraphs.join("\n\n");
      const plainText = ensureSentenceEnd(
        announcement
          ? paragraphText ? `${announcement}.\n\n${paragraphText}` : announcement
          : paragraphText
      );

      // Stücke ohne Buchstaben und Ziffern (nur Satzzeichen, Leerraum) lehnt die Stimme ab: überspringen
      if (!/[\p{L}\p{N}]/u.test(plainText)) {
        params.onChunk(i + 1, segments.length);
        continue;
      }

      // Cache-Schlüssel aus Text, Stimme, Tempo
      const cacheKey = chunkHash({
        text: plainText,
        voice: segVoice.id,
        rate,
        chapterId: chapter.id,
        index: i,
      });
      const chunkPath = join(
        tmpDir,
        `chunk-${String(i).padStart(3, "0")}-${cacheKey}.mp3`
      );

      if (existsSync(chunkPath) && statSync(chunkPath).size > 0) {
        console.log(
          `[tts] chunk ${i + 1}/${segments.length} cached (${cacheKey}) — skip`
        );
        chunkFiles.push(chunkPath);
        params.onChunk(i + 1, segments.length);
        skippedCount++;
        continue;
      }

      // Gesendeten Text neben der MP3 ablegen: Hänger nachstellbar
      const textDumpPath = join(
        tmpDir,
        `chunk-${String(i).padStart(3, "0")}-${cacheKey}.txt`
      );
      try {
        writeFileSync(textDumpPath, plainText, "utf8");
      } catch (err) {
        console.warn(`[tts] could not write chunk-text dump:`, err);
      }

      const t0 = Date.now();
      console.log(
        `[tts] chunk ${i + 1}/${segments.length} (${cacheKey}) → ${plainText.length} chars, synth start`
      );
      const { engineId } = await synthesizeChunk({
        segment: { paragraphs: segments[i].paragraphs },
        text: plainText,
        voice: segVoice,
        locale: segVoice === voice ? locale : segVoice.locale,
        rate,
        announce: announcement,
        outPath: chunkPath,
        signal,
      });
      const took = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `[tts] chunk ${i + 1}/${segments.length} (${cacheKey}) done in ${took}s`
      );
      chunkFiles.push(chunkPath);
      params.onChunk(i + 1, segments.length);
      if (i < segments.length - 1) {
        await interChunkPause(engineId);
      }
    }

    console.log(
      `[tts] chapter ${chapter.number}: ${segments.length} chunks ready (${skippedCount} cached, ${segments.length - skippedCount} fresh) in ${((Date.now() - bookStart) / 1000).toFixed(1)}s`
    );

    const mergedPath = join(tmpDir, "merged.mp3");
    // Pausen: 300 ms zwischen Chunks, 1200 ms am Kapitelende; Intro mit 1,5 s davor und 700 ms je Zeile
    await concatMp3WithGaps(chunkFiles, mergedPath, params.intro ? { leadingMs: 1500, interChunkMs: 700, trailingMs: 1500 } : { interChunkMs: 300, trailingMs: 1200 });

    const cover = coverPathFor(chapter.document_id);
    const { durationMs } = await normalizeAndTag({
      input: mergedPath,
      output: outFile,
      title: chapter.title || `Chapter ${chapter.number}`,
      album: await documentTitle(chapter.document_id),
      trackNumber: chapter.number,
      coverPath: cover,
    });

    success = true;
    return { durationMs };
  } finally {
    // Nur bei Erfolg aufräumen, sonst Wiederaufnahme möglich
    if (success) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    } else {
      console.log(
        `[tts] chapter ${chapter.number} failed — keeping tmp dir ${tmpDir} for resume`
      );
    }
  }
}
