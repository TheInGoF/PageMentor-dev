// Ein Kapitel in Chunks synthetisieren und zu einer MP3 zusammenfügen
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { segmentText } from "../../tts/segment";
import { applyPronunciation } from "../pronunciation";
import { canBatch, qwenBatchSize, synthesizeQwenBatch } from "../../tts/engines/qwen/batch";
import { synthesizeChunk, interChunkPause, maxChunkFor } from "../../tts/synth";
import { concatMp3WithGaps, normalizeAndTag } from "../../tts/ffmpeg";
import type { Voice } from "../../tts/engines/base";
import { AudiobookCanceled, type Chapter } from "./state";
import { chunkHash, documentTitle } from "./files";
import { ensureCover } from "../covers";

// Text mit . ! ? abschließen
// Ohne Punkt spricht Qwen das letzte Wort abgehackt
export function ensureSentenceEnd(text: string): string {
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
  // batch: so viele Stücke ab current+1 gerade in einem Qwen-Durchgang
  onChunk: (current: number, total: number, batch?: number) => void;
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

    // Text, Stimme und Datei eines Abschnitts; null = nichts zu sprechen (leerer Platzhalter, nur Satzzeichen)
    const explicitTitle = chapter.title?.trim() ? speak(chapter.title.trim()) : undefined;
    const jobFor = (i: number) => {
      let announcement: string | undefined;
      if (i === 0) {
        if (explicitTitle) {
          announcement = isDe ? `Kapitel: ${explicitTitle}` : `Chapter: ${explicitTitle}`;
        } else if (chapter.number > 0) {
          announcement = isDe ? `Kapitel ${chapter.number}` : `Chapter ${chapter.number}`;
        }
      }
      const segVoice = segments[i].voice;
      if (!announcement && !segments[i].paragraphs.length) return null;
      const paragraphText = segments[i].paragraphs.join("\n\n");
      const plainText = ensureSentenceEnd(announcement ? (paragraphText ? `${announcement}.\n\n${paragraphText}` : announcement) : paragraphText);
      // Stücke ohne Buchstaben und Ziffern (nur Satzzeichen, Leerraum) lehnt die Stimme ab: überspringen
      if (!/[\p{L}\p{N}]/u.test(plainText)) return null;
      // Cache-Schlüssel aus Text, Stimme, Tempo
      const cacheKey = chunkHash({ text: plainText, voice: segVoice.id, rate, chapterId: chapter.id, index: i });
      const name = `chunk-${String(i).padStart(3, "0")}-${cacheKey}`;
      return { announcement, segVoice, plainText, cacheKey, chunkPath: join(tmpDir, `${name}.mp3`), textDumpPath: join(tmpDir, `${name}.txt`) };
    };
    const done = (path: string) => existsSync(path) && statSync(path).size > 0;
    // Gesendeten Text neben der MP3 ablegen: Hänger nachstellbar
    const dumpText = (path: string, text: string) => {
      try {
        writeFileSync(path, text, "utf8");
      } catch (err) {
        console.warn(`[tts] could not write chunk-text dump:`, err);
      }
    };
    const batchSize = qwenBatchSize();

    const chunkFiles: string[] = [];
    let skippedCount = 0;
    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted) throw new AudiobookCanceled();
      const job = jobFor(i);
      if (!job) {
        params.onChunk(i + 1, segments.length);
        continue;
      }
      const { announcement, segVoice, plainText, cacheKey, chunkPath, textDumpPath } = job;

      if (done(chunkPath)) {
        console.log(
          `[tts] chunk ${i + 1}/${segments.length} cached (${cacheKey}) — skip`
        );
        chunkFiles.push(chunkPath);
        params.onChunk(i + 1, segments.length);
        skippedCount++;
        continue;
      }

      dumpText(textDumpPath, plainText);

      // Qwen-Batching: die folgenden offenen Abschnitte derselben eigenen Stimme gleich mitsprechen.
      // Geht der Durchgang schief, spricht die Schleife sie einzeln wie bisher
      if (batchSize > 1 && canBatch(segVoice)) {
        const group = [job];
        for (let k = i + 1; k < segments.length && group.length < batchSize; k++) {
          const next = jobFor(k);
          if (!next) continue;
          if (next.segVoice.id !== segVoice.id) break;
          if (!done(next.chunkPath)) group.push(next);
        }
        if (group.length > 1) {
          const tb = Date.now();
          params.onChunk(i, segments.length, group.length);
          try {
            for (const g of group) dumpText(g.textDumpPath, g.plainText);
            await synthesizeQwenBatch({ texts: group.map((g) => g.plainText), voice: segVoice, rate, outPaths: group.map((g) => g.chunkPath), signal });
            console.log(`[tts] chunks ${i + 1}… (${group.length} im Durchgang) done in ${((Date.now() - tb) / 1000).toFixed(1)}s`);
          } catch (err) {
            if (signal.aborted) throw new AudiobookCanceled();
            console.warn(`[tts] Qwen-Durchgang fehlgeschlagen, Abschnitte einzeln:`, err instanceof Error ? err.message : err);
          }
          if (done(chunkPath)) {
            chunkFiles.push(chunkPath);
            params.onChunk(i + 1, segments.length);
            continue;
          }
        }
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

    const cover = await ensureCover(chapter.document_id);
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
