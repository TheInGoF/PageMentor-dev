// Ein Kapitel in Chunks synthetisieren und zu einer MP3 zusammenfügen
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { segmentText } from "../../tts/segment";
import { synthesizeChunk, interChunkPause } from "../../tts/synth";
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

export async function synthesizeChapter(params: {
  chapter: Chapter;
  audioDir: string;
  voice: Voice;
  locale: string;
  rate: string;
  outFile: string;
  signal: AbortSignal;
  onChunk: (current: number, total: number) => void;
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
    const segments = segmentText(chapter.text);
    if (segments.length === 0) {
      // Sollte nach der Prüfung oben nicht vorkommen
      throw new Error("No segments from chapter text.");
    }

    // Gesamtzahl sofort melden
    params.onChunk(0, segments.length);

    const isDe = params.voice.locale.startsWith("de");
    const bookStart = Date.now();

    const chunkFiles: string[] = [];
    let skippedCount = 0;
    for (let i = 0; i < segments.length; i++) {
      if (signal.aborted) throw new AudiobookCanceled();
      const explicitTitle = chapter.title?.trim();
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
      const paragraphText = segments[i].paragraphs.join("\n\n");
      const plainText = ensureSentenceEnd(
        announcement
          ? `${announcement}.\n\n${paragraphText}`
          : paragraphText
      );

      // Cache-Schlüssel aus Text, Stimme, Tempo
      const cacheKey = chunkHash({
        text: plainText,
        voice: voice.id,
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
        segment: segments[i],
        text: plainText,
        voice,
        locale,
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
    // Pausen: 300 ms zwischen Chunks, 1200 ms am Kapitelende
    await concatMp3WithGaps(chunkFiles, mergedPath, {
      interChunkMs: 300,
      trailingMs: 1200,
    });

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
