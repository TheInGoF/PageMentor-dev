// Ganzes Hörbuch: alle gewählten Kapitel, danach M4B
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { buildM4B, probeDurationMs } from "../../tts/ffmpeg";
import { findVoice, defaultVoiceFor } from "../../tts/voices";
import { preprocessChapterForAudio, preprocessAvailable } from "../audioPreprocess";
import { ensureCover } from "../covers";
import { emit } from "../events";
import { pickLang, tLang, chapterLabel } from "../../lib/i18n";
import {
  running,
  isIncluded,
  AudiobookCanceled,
  type Chapter,
  type Document,
  type RunState,
} from "./state";
import { chapterFile, deleteAudioForChapter, relPath, upsertAudio } from "./files";
import { synthesizeChapter } from "./synthChapter";
import { runJob } from "../../log/jobs";
import { exportBook } from "./export";

async function generateAudiobookImpl(params: {
  docId: string;
  voiceId?: string;
  rate?: string;
  // LLM für die Aufbereitung, leer = Standard aus den Settings
  model?: string;
}): Promise<void> {
  if (running.has(params.docId)) return;
  const abortController = new AbortController();
  const runState: RunState = {
    ctrl: abortController,
    startedAt: Date.now(),
    totalChapters: 0,
    currentChapter: 0,
    chunkCurrent: 0,
    chunkTotal: 0,
    chapterChars: [],
  };
  running.set(params.docId, runState);
  const signal = abortController.signal;

  const d = db();
  const doc = d
    .prepare(
      `SELECT d.id, d.title, d.doc_title, d.author, d.short_code, d.series_sequence, d.language,
              m.name AS module_name
       FROM documents d
       LEFT JOIN modules m ON m.id = d.module_id
       WHERE d.id = ?`
    )
    .get(params.docId) as Document | undefined;
  if (!doc) {
    running.delete(params.docId);
    throw new Error("Document not found");
  }

  const allChapters = d
    .prepare(
      "SELECT id, document_id, number, title, text, start_page, end_page, sort_order, kind, include_in_audio FROM chapters WHERE document_id = ? ORDER BY sort_order ASC, number ASC"
    )
    .all(doc.id) as Chapter[];

  if (allChapters.length === 0) {
    running.delete(params.docId);
    throw new Error("No chapters - run chapter detection first.");
  }

  // Auswahl des Nutzers; ist nichts gewählt: alle Kapitel
  const filtered = allChapters.filter(isIncluded);
  const chapters = filtered.length > 0 ? filtered : allChapters;

  const voiceId = params.voiceId || defaultVoiceFor(doc.language);
  if (!voiceId) {
    running.delete(params.docId);
    throw new Error(
      "No TTS voice available for this language."
    );
  }
  // Sprache mitgeben: Preset-IDs gibt es in de und en
  const voice = findVoice(voiceId, doc.language);
  if (!voice) {
    running.delete(params.docId);
    throw new Error(`Unknown voice: ${voiceId}`);
  }
  const engineId = voice.engine;
  const locale = voice.locale;
  const rate = params.rate || "+0%";

  const audioDir = join(DATA_DIR, "audio", doc.id);
  mkdirSync(audioDir, { recursive: true });

  const lang = pickLang(doc.language);

  // Für GET /api/audio/progress nach Reload
  runState.totalChapters = chapters.length;
  runState.chapterChars = chapters.map((c) => c.text?.length ?? 0);

  emit({
    phase: "audiobook.start",
    docId: doc.id,
    total: chapters.length,
    message: tLang(lang, "msg.audiobookStart", {
      count: chapters.length,
      voice: voice?.label ?? voiceId,
    }),
  });

  // Kein GPU-Reset vorab: Arbiter wechselt beim ersten TTS-Aufruf
  // Reset vorab führte zu Race und Circuit-Breaker

  // LLM einmal vor der Schleife prüfen
  const llmReady = await preprocessAvailable();
  if (!llmReady) {
    console.warn(tLang(lang, "msg.audioPreprocessUnavailable"));
  }

  const successfulChapterFiles: string[] = [];
  const chapterDurations: Array<{ title: string; durationMs: number }> = [];

  // Abbruch nach so vielen Fehlern in Folge: Sidecar vermutlich tot
  const MAX_CONSECUTIVE_FAILURES = 3;
  let consecutiveFailures = 0;
  let abortedDueToFailures = false;

  try {
    for (let i = 0; i < chapters.length; i++) {
      if (signal.aborted) throw new AudiobookCanceled();
      const ch = chapters[i];
      const outFile = chapterFile(audioDir, ch);
      runState.currentChapter = i + 1;
      runState.chunkCurrent = 0;
      runState.chunkTotal = 0;

      // Fertige Kapitel nicht neu erzeugen
      const existingAudio = d
        .prepare(
          "SELECT status, duration_ms FROM audio WHERE chapter_id = ?"
        )
        .get(ch.id) as
        | { status: string; duration_ms: number }
        | undefined;

      // Alte Zeilen ohne done-Status verwerfen, sonst ewig "fehlgeschlagen"
      if (existingAudio && existingAudio.status !== "done") {
        console.log(
          `[audiobook] chapter ${ch.number}: dropping stale audio row (status=${existingAudio.status}) before re-generate`
        );
        deleteAudioForChapter(ch.id, outFile);
      }

      if (
        existingAudio?.status === "done" &&
        existsSync(outFile)
      ) {
        console.log(
          `[audiobook] chapter ${ch.number} already done — skip synth (${existingAudio.duration_ms}ms existing)`
        );
        successfulChapterFiles.push(outFile);
        chapterDurations.push({
          title: ch.title || chapterLabel(lang, ch.number),
          durationMs: existingAudio.duration_ms,
        });
        // Fortschritt trotzdem melden
        emit({
          phase: "audiobook.chapter.done",
          docId: doc.id,
          chapterId: ch.id,
          chapterNumber: ch.number,
          current: i + 1,
          total: chapters.length,
        });
        continue;
      }

      // LLM-Aufbereitung, gecacht in chapters.audio_text
      // Bei Fehler: Rohtext, grobes Hörbuch schlägt keins
      let chapterText = ch.text;
      if (llmReady) {
        try {
          emit({
            phase: "audiobook.chapter.preprocess",
            docId: doc.id,
            chapterId: ch.id,
            chapterNumber: ch.number,
            current: i + 1,
            total: chapters.length,
          });
          const pp = await preprocessChapterForAudio({
            chapterId: ch.id,
            language: doc.language,
            model: params.model,
          });
          chapterText = pp.text;
          console.log(
            `[audiobook] chapter ${ch.number} preprocessed by model="${pp.model}" (requested="${params.model ?? "(default)"}", cached=${pp.cached})`
          );
        } catch (err) {
          console.warn(
            `[audiobook] preprocess failed for chapter ${ch.number}, falling back to raw text:`,
            err
          );
        }
      }

      emit({
        phase: "audiobook.chapter.start",
        docId: doc.id,
        chapterId: ch.id,
        chapterNumber: ch.number,
        current: i + 1,
        total: chapters.length,
        message: ch.title || chapterLabel(lang, ch.number),
      });

      try {
        const { durationMs } = await synthesizeChapter({
          chapter: { ...ch, text: chapterText },
          audioDir,
          voice,
          locale,
          rate,
          outFile,
          signal,
          onChunk: (chunkIdx, chunkTotal) => {
            runState.chunkCurrent = chunkIdx;
            runState.chunkTotal = chunkTotal;
            emit({
              phase: "audiobook.chapter.progress",
              docId: doc.id,
              chapterId: ch.id,
              chapterNumber: ch.number,
              current: chunkIdx,
              total: chunkTotal,
            });
          },
        });

        upsertAudio({
          chapterId: ch.id,
          storedRelPath: relPath(outFile),
          durationMs,
          voice: voiceId,
          engine: engineId,
          status: "done",
        });

        successfulChapterFiles.push(outFile);
        chapterDurations.push({
          title: ch.title || chapterLabel(lang, ch.number),
          durationMs,
        });
        // Erfolg setzt den Fehlerzähler zurück
        consecutiveFailures = 0;

        emit({
          phase: "audiobook.chapter.done",
          docId: doc.id,
          chapterId: ch.id,
          chapterNumber: ch.number,
          current: i + 1,
          total: chapters.length,
        });
      } catch (err) {
        if (err instanceof AudiobookCanceled) throw err;
        // Abbruch während Synth: als Abbruch werten, nicht als Fehler
        if (signal.aborted) throw new AudiobookCanceled();
        // Keine failed-Zeile anlegen, Reste aufräumen
        deleteAudioForChapter(ch.id, outFile);
        const message = err instanceof Error ? err.message : String(err);

        emit({
          phase: "audiobook.chapter.failed",
          docId: doc.id,
          chapterId: ch.id,
          chapterNumber: ch.number,
          current: i + 1,
          total: chapters.length,
          message,
        });
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(
            `[tts] aborting audiobook run — ${consecutiveFailures} consecutive ` +
              `chapter failures (sidecar likely down or persistently looping). ` +
              `Last error: ${message}`
          );
          abortedDueToFailures = true;
          break;
        }
        console.error(`[tts] chapter ${ch.number} failed:`, err);
      }
    }

    {
      if (abortedDueToFailures) {
        // Kein Teil-M4B nach Sidecar-Ausfall, sähe nach Erfolg aus
        // Fertige Kapitel bleiben für einen neuen Lauf
        emit({
          phase: "audiobook.failed",
          docId: doc.id,
          message:
            `Aborted after ${MAX_CONSECUTIVE_FAILURES} consecutive ` +
            `chapter failures — sidecar unreachable or persistently ` +
            `looping. Existing chapters are kept; rerun once the ` +
            `sidecar is back.`,
        });
        running.delete(params.docId);
        return;
      }
      if (successfulChapterFiles.length > 0) {
        emit({
          phase: "audiobook.book.building",
          docId: doc.id,
          message: tLang(lang, "msg.buildingM4B"),
        });

        // Intro als Spur 0, echte Dauer messen
        // sonst verschieben sich alle Kapitelmarken
        const introPath = join(audioDir, "intro.mp3");
        const inputs = [...successfulChapterFiles];
        const m4bChapters = [...chapterDurations];
        if (existsSync(introPath)) {
          const introMs = await probeDurationMs(introPath).catch(() => 0);
          inputs.unshift(introPath);
          m4bChapters.unshift({
            title: tLang(lang, "label.intro"),
            durationMs: introMs,
          });
        }

        const bookPath = join(audioDir, "book.m4b");
        try {
          let lastM4bEmit = 0;
          await buildM4B({
            inputs,
            chapters: m4bChapters,
            output: bookPath,
            title: doc.title || doc.doc_title || "",
            artist: doc.author ?? undefined,
            shortCode: doc.short_code ?? undefined,
            series: doc.module_name ?? undefined,
            seriesSequence: doc.series_sequence ?? undefined,
            coverPath: await ensureCover(doc.id),
            onProgress: (currentMs, totalMs) => {
              const now = Date.now();
              if (now - lastM4bEmit < 500 && currentMs < totalMs) return;
              lastM4bEmit = now;
              emit({
                phase:
                  currentMs === 0
                    ? "audiobook.m4b.start"
                    : "audiobook.m4b.progress",
                docId: doc.id,
                current: currentMs,
                total: totalMs,
              });
            },
          });
          exportBook(doc.id);
          emit({
            phase: "audiobook.m4b.done",
            docId: doc.id,
            current: 1,
            total: 1,
          });
        } catch (err) {
          console.error(`[tts] M4B build failed:`, err);
        }
      }

      const totalSeconds = ((Date.now() - runState.startedAt) / 1000).toFixed(1);
      console.log(
        `[audiobook] ALL DONE for doc=${doc.id}: ` +
          `${chapters.length} chapters processed in ${totalSeconds}s ` +
          `(${successfulChapterFiles.length} synthesized fresh, ` +
          `${chapters.length - successfulChapterFiles.length} cached/skipped)`
      );
      // Vor dem Abschluss-Event austragen, sonst hängt die UI
      running.delete(params.docId);
      emit({ phase: "audiobook.done", docId: doc.id, total: chapters.length });
    }
  } catch (err) {
    running.delete(params.docId);
    if (err instanceof AudiobookCanceled) {
      emit({
        phase: "audiobook.canceled",
        docId: doc.id,
        message: "aborted by user",
      });
    } else {
      emit({
        phase: "audiobook.failed",
        docId: doc.id,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  } finally {
    running.delete(params.docId);
  }
}

export function generateAudiobook(...args: Parameters<typeof generateAudiobookImpl>): ReturnType<typeof generateAudiobookImpl> {
  return runJob("audiobook", "audiobook", { docId: args[0].docId }, () => generateAudiobookImpl(...args));
}
