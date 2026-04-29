import { join } from "path";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from "fs";
import { createHash } from "crypto";
import { join as pathJoin } from "path";
import { db } from "../db";
import { segmentText } from "../tts/segment";
import { synthesizeChunk, interChunkPause } from "../tts/synth";
import { concatMp3WithGaps, normalizeAndTag, buildM4B } from "../tts/ffmpeg";
import { findVoice, defaultVoiceFor } from "../tts/voices";
import type { EngineId } from "../tts/engines/base";
import {
  preprocessChapterForAudio,
  preprocessAvailable,
} from "./audioPreprocess";
import { ensureCover } from "./covers";
import { emit } from "./events";
import { pickLang, tLang, chapterLabel } from "../lib/i18n";
import { effective } from "./llmConfig";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";

interface Chapter {
  id: string;
  document_id: string;
  number: number;
  title: string;
  text: string;
  start_page: number;
  end_page: number;
  sort_order: number;
  kind?: string;
  include_in_audio?: number | null;
}

/** Default selection when `include_in_audio` isn't set yet for a
 *  chapter (old rows before v1.14.001). Maintenance-release chapters
 *  (exercises, indexes) stay off, content + summary on. */
function defaultIncludeForKind(kind: string | undefined): boolean {
  return kind === "content" || kind === "summary";
}

function isIncluded(ch: Pick<Chapter, "kind" | "include_in_audio">): boolean {
  if (ch.include_in_audio == null) return defaultIncludeForKind(ch.kind);
  return ch.include_in_audio === 1;
}

interface Document {
  id: string;
  title: string;
  doc_title: string | null;
  author: string | null;
  short_code: string | null;
  module_name: string | null;
  language: string;
}

const running = new Map<string, AbortController>();

export function isGenerating(docId: string): boolean {
  return running.has(docId);
}

export class AudiobookCanceled extends Error {
  constructor() {
    super("audiobook.canceled");
    this.name = "AudiobookCanceled";
  }
}

/** Signals the running worker to stop after the current chunk AND
 *  hard-restarts the TTS sidecar via the GPU arbiter so an in-flight
 *  Sidecar generation actually terminates. The audiobook loop's
 *  AbortSignal alone only releases the Backend → Arbiter HTTP call;
 *  the Sidecar would otherwise keep generating until its 1200 s
 *  timeout (zombie generation), and a follow-up TTS call could
 *  collide with leftover state. Already-finished chapter MP3s on
 *  disk are kept. */
export function cancelAudiobook(docId: string): boolean {
  const ctrl = running.get(docId);
  if (!ctrl) return false;
  ctrl.abort();
  // Fire-and-forget — we don't want the cancel HTTP response to
  // block on the arbiter restart (which can take a few seconds).
  void resetGpuViaArbiter().catch((err) => {
    console.warn(
      "[audiobook] cancel: arbiter reset failed (sidecar may still be running):",
      err,
    );
  });
  return true;
}

async function resetGpuViaArbiter(): Promise<void> {
  const base = effective("qwenTtsUrl", "PM_QWEN_TTS_URL");
  if (!base) {
    console.warn(
      "[audiobook] cancel: no arbiter URL configured — Sidecar may " +
        "keep generating until its own timeout",
    );
    return;
  }
  const url = base.replace(/\/+$/, "") + "/admin/gpu/reset";
  const apiKey = effective("qwenTtsApiKey", "PM_QWEN_TTS_API_KEY");
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  console.log(`[audiobook] cancel: hard-resetting GPU via ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`arbiter reset ${res.status}`);
  }
}

export async function generateAudiobook(params: {
  docId: string;
  voiceId?: string;
  rate?: string;
  /** Override for the preprocess LLM. Comes from the frontend via
   *  `settings.defaultOllamaModel`. When empty the LLM-config
   *  default (Settings → LLM → Ollama model) is used. */
  model?: string;
}): Promise<void> {
  if (running.has(params.docId)) return;
  const abortController = new AbortController();
  running.set(params.docId, abortController);
  const signal = abortController.signal;

  const d = db();
  const doc = d
    .prepare(
      `SELECT d.id, d.title, d.doc_title, d.author, d.short_code, d.language,
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

  // Respect the user's per-chapter selection. If none are active
  // (user turned everything off or an edge-case doc), fall back to
  // the kind-based default logic so something at least gets
  // generated.
  const filtered = allChapters.filter(isIncluded);
  const chapters = filtered.length > 0 ? filtered : allChapters;

  const voiceId = params.voiceId || defaultVoiceFor(doc.language);
  if (!voiceId) {
    running.delete(params.docId);
    throw new Error(
      "No TTS voice available for this language."
    );
  }
  const voice = findVoice(voiceId);
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

  emit({
    phase: "audiobook.start",
    docId: doc.id,
    total: chapters.length,
    message: tLang(lang, "msg.audiobookStart", {
      count: chapters.length,
      voice: voice?.label ?? voiceId,
    }),
  });

  // Check preprocessor availability once before the loop — avoids
  // N Ollama pings, the `pickProvider()` cache lasts 30 s.
  const llmReady = await preprocessAvailable();
  if (!llmReady) {
    console.warn(tLang(lang, "msg.audioPreprocessUnavailable"));
  }

  const successfulChapterFiles: string[] = [];
  const chapterDurations: Array<{ title: string; durationMs: number }> = [];

  // Stop the run if we get this many failed chapters in a row. One
  // bad chapter shouldn't take the whole book down, but if the
  // sidecar is dead / unreachable / persistently looping, plowing
  // through 20 more chapters and then building a partial M4B from
  // what already existed is not what anyone wants.
  const MAX_CONSECUTIVE_FAILURES = 3;
  let consecutiveFailures = 0;
  let abortedDueToFailures = false;

  try {
    for (let i = 0; i < chapters.length; i++) {
      if (signal.aborted) throw new AudiobookCanceled();
      const ch = chapters[i];
      const outFile = chapterFile(audioDir, ch);

      // Skip check: don't regenerate already-finished chapters.
      // When the user clicks "Generate audiobook" after pre-building
      // individual chapters, the finished ones should be kept and
      // only the missing chapters added. The per-chapter clear
      // button allows explicit regeneration.
      const existingAudio = d
        .prepare(
          "SELECT status, duration_ms FROM audio WHERE chapter_id = ?"
        )
        .get(ch.id) as
        | { status: string; duration_ms: number }
        | undefined;

      // Stale non-done rows (failed / running / pending leftovers
      // from a crashed earlier run, or rows written by older
      // PageMentor versions) are dropped right here. Without this,
      // a "failed" status survives forever — the catch-block below
      // only fires when THIS run's synth fails, never on inherited
      // rows. Keeping them around makes the chapter look perma-broken
      // in the UI even though a fresh generate would succeed.
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
        // Still emit progress to the frontend, otherwise the UI sits
        // on "preprocessing" briefly with no feedback.
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

      // Preprocessing: LLM cleans the text for TTS (expand abbreviations,
      // verbalize formulas, strip citations). Cached in
      // `chapters.audio_text` — no LLM call on second run.
      // Failure or LLM offline → fall back to original text, because
      // a rough audiobook still beats no audiobook at all.
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
          onChunk: (chunkIdx, chunkTotal) =>
            emit({
              phase: "audiobook.chapter.progress",
              docId: doc.id,
              chapterId: ch.id,
              chapterNumber: ch.number,
              current: chunkIdx,
              total: chunkTotal,
            }),
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
        // A successful chapter resets the abort counter — runs that
        // recover after one or two bad chapters carry on.
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
        // Don't create a failed DB row anymore — useless, only needs
        // manual cleanup. If a previous run left an old file/row for
        // this chapter, clean it up now so the UI shows the chapter
        // cleanly as "no audio yet".
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
        // Don't build a partial M4B from chapters generated before a
        // sidecar collapse. The user almost never wants "first 2 of 8
        // chapters as a finished audiobook" — that just looks like
        // success and they only notice mid-listen. Better: surface the
        // failure clearly and leave the existing chapter MP3s on disk
        // so they can rerun "Generate Missing" once the sidecar is
        // back.
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

        // If an intro MP3 exists, prepend it as track 0. Duration
        // via ffprobe (inside buildM4B) — we pass 0 here, ffmpeg
        // determines the actual length itself. The chapter-marker
        // label is language-dependent — only shown in the player,
        // not spoken.
        const introPath = join(audioDir, "intro.mp3");
        const inputs = [...successfulChapterFiles];
        const m4bChapters = [...chapterDurations];
        if (existsSync(introPath)) {
          inputs.unshift(introPath);
          m4bChapters.unshift({ title: tLang(lang, "label.intro"), durationMs: 0 });
        }

        const bookPath = join(audioDir, "book.m4b");
        try {
          let lastM4bEmit = 0;
          await buildM4B({
            inputs,
            chapters: m4bChapters,
            output: bookPath,
            title: doc.doc_title || doc.title,
            artist: doc.author ?? undefined,
            shortCode: doc.short_code ?? undefined,
            series: doc.module_name ?? undefined,
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

      emit({ phase: "audiobook.done", docId: doc.id, total: chapters.length });
    }
  } catch (err) {
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

/**
 * Generates audio for ONE chapter. Unlike `generateAudiobook`, no
 * preprocessor runs here, no M4B is built, and there's no circuit
 * breaker — the caller knows what they're doing (UI flow: the user
 * explicitly picked the chapter and may have already curated the
 * audio_text).
 *
 * Uses `audio_text` if set, otherwise falls back to `text`. The
 * result is persisted in the `audio` table + ffmpeg-normalized
 * just like the full pipeline.
 */
export async function generateSingleChapterAudio(params: {
  chapterId: string;
  voiceId: string;
  rate?: string;
}): Promise<{ audioId: string; durationMs: number }> {
  const d = db();
  const row = d
    .prepare(
      `SELECT c.id, c.document_id, c.number, c.title, c.text, c.audio_text,
              c.start_page, c.end_page, c.sort_order, c.kind,
              doc.title as doc_title, doc.language
       FROM chapters c
       JOIN documents doc ON doc.id = c.document_id
       WHERE c.id = ?`
    )
    .get(params.chapterId) as
    | (Chapter & { audio_text: string | null; doc_title: string; language: string })
    | undefined;
  if (!row) throw new Error("Chapter not found");

  const voice = findVoice(params.voiceId);
  if (!voice) throw new Error(`Unknown voice: ${params.voiceId}`);
  const rate = params.rate || "+0%";

  // Prefer audio_text — the user may have curated it manually.
  const effectiveText = (row.audio_text && row.audio_text.trim().length > 0)
    ? row.audio_text
    : row.text;

  const audioDir = join(DATA_DIR, "audio", row.document_id);
  mkdirSync(audioDir, { recursive: true });
  const outFile = chapterFile(audioDir, row as Chapter);

  // Drop any stale non-done audio row for this chapter before the
  // fresh synth — same rationale as in the full-book loop.
  const staleAudio = db()
    .prepare("SELECT status FROM audio WHERE chapter_id = ?")
    .get(row.id) as { status: string } | undefined;
  if (staleAudio && staleAudio.status !== "done") {
    console.log(
      `[audiobook] single-chapter: dropping stale audio row (status=${staleAudio.status}) for chapter ${row.id}`
    );
    deleteAudioForChapter(row.id, outFile);
  }

  // Register single-chapter runs in the `running` map too, so
  // `cancelAudiobook(docId)` stops them. If a full-book run is
  // already running we share its controller — one click then
  // cancels both.
  const alreadyRunning = running.has(row.document_id);
  const abortController =
    running.get(row.document_id) ?? new AbortController();
  if (!alreadyRunning) {
    running.set(row.document_id, abortController);
  }

  const chapterForSynth: Chapter = {
    ...row,
    text: effectiveText,
    kind: row.kind,
  };

  emit({
    phase: "audiobook.chapter.start",
    docId: row.document_id,
    chapterId: row.id,
    chapterNumber: row.number,
    current: 1,
    total: 1,
    message: row.title || chapterLabel(pickLang(row.language), row.number),
  });

  try {
    const { durationMs } = await synthesizeChapter({
      chapter: chapterForSynth,
      audioDir,
      voice,
      locale: voice.locale,
      rate,
      outFile,
      signal: abortController.signal,
      onChunk: (current, total) =>
        emit({
          phase: "audiobook.chapter.progress",
          docId: row.document_id,
          chapterId: row.id,
          chapterNumber: row.number,
          current,
          total,
        }),
    });

    upsertAudio({
      chapterId: row.id,
      storedRelPath: relPath(outFile),
      durationMs,
      voice: params.voiceId,
      engine: voice.engine,
      status: "done",
    });

    // The book M4B is now stale (may not include this chapter or
    // still has the old version). Delete it so the download button
    // goes offline until a new full run completes.
    const bookPath = join(audioDir, "book.m4b");
    if (existsSync(bookPath)) {
      try {
        rmSync(bookPath, { force: true });
      } catch {
        // best effort
      }
    }

    emit({
      phase: "audiobook.chapter.done",
      docId: row.document_id,
      chapterId: row.id,
      chapterNumber: row.number,
      current: 1,
      total: 1,
    });

    const audioIdRow = d
      .prepare("SELECT id FROM audio WHERE chapter_id = ?")
      .get(row.id) as { id: string } | undefined;

    return { audioId: audioIdRow?.id ?? "", durationMs };
  } catch (err) {
    emit({
      phase: "audiobook.chapter.failed",
      docId: row.document_id,
      chapterId: row.id,
      chapterNumber: row.number,
      current: 1,
      total: 1,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    if (!alreadyRunning) running.delete(row.document_id);
  }
}

/** Generates the intro audio (a .mp3 placed before the first
 *  chapter). Uses the same TTS path as a chapter but stores it under
 *  the deterministic path `audio/{docId}/intro.mp3` with no DB row. */
export async function generateIntroAudio(params: {
  docId: string;
  text: string;
  voiceId: string;
  rate?: string;
}): Promise<{ path: string; durationMs: number }> {
  const voice = findVoice(params.voiceId);
  if (!voice) throw new Error(`Unknown voice: ${params.voiceId}`);
  const rate = params.rate || "+0%";

  const introDoc = db()
    .prepare("SELECT language FROM documents WHERE id = ?")
    .get(params.docId) as { language: string } | undefined;
  const lang = pickLang(introDoc?.language);

  const audioDir = join(DATA_DIR, "audio", params.docId);
  mkdirSync(audioDir, { recursive: true });
  const outFile = join(audioDir, "intro.mp3");

  // Invalidate any existing M4B — new intro = old book no longer matches.
  const bookPath = join(audioDir, "book.m4b");
  if (existsSync(bookPath)) {
    try {
      rmSync(bookPath, { force: true });
    } catch {
      /* best effort */
    }
  }

  emit({
    phase: "audiobook.chapter.start",
    docId: params.docId,
    chapterNumber: 0,
    current: 1,
    total: 1,
    message: tLang(lang, "label.intro"),
  });

  const alreadyRunning = running.has(params.docId);
  const abortController =
    running.get(params.docId) ?? new AbortController();
  if (!alreadyRunning) {
    running.set(params.docId, abortController);
  }
  // Synthetic single chapter. Title is deliberately EMPTY — the
  // user intro text ("Audiobook: Foo. Written by Bar.") is
  // self-explanatory; an additional TTS announcement "Intro." up
  // front would feel redundant.
  const synth: Chapter = {
    id: `intro-${params.docId}`,
    document_id: params.docId,
    number: 0,
    title: "",
    text: params.text,
    start_page: 0,
    end_page: 0,
    sort_order: -1,
    kind: "meta",
  };

  try {
    const { durationMs } = await synthesizeChapter({
      chapter: synth,
      audioDir,
      voice,
      locale: voice.locale,
      rate,
      outFile,
      signal: abortController.signal,
      onChunk: (current, total) =>
        emit({
          phase: "audiobook.chapter.progress",
          docId: params.docId,
          chapterNumber: 0,
          current,
          total,
        }),
    });
    emit({
      phase: "audiobook.chapter.done",
      docId: params.docId,
      chapterNumber: 0,
      current: 1,
      total: 1,
    });
    return { path: outFile, durationMs };
  } catch (err) {
    emit({
      phase: "audiobook.chapter.failed",
      docId: params.docId,
      chapterNumber: 0,
      current: 1,
      total: 1,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    if (!alreadyRunning) running.delete(params.docId);
  }
}

async function synthesizeChapter(params: {
  chapter: Chapter;
  audioDir: string;
  voice: import("../tts/engines/base").Voice;
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

  // Tmp dir stays stable per chapter. On successful generation it's
  // deleted at the end; on failure KEPT — that way already-finished
  // chunks can be skipped on retry.
  const tmpDir = join(audioDir, `.tmp-${chapter.id}`);
  mkdirSync(tmpDir, { recursive: true });

  let success = false;
  try {
    const segments = segmentText(chapter.text);
    if (segments.length === 0) {
      // No good language hint here (this helper is generic); fall back
      // to English. Caller already validated chapter text upstream, so
      // this is mostly an internal-bug signal.
      throw new Error("No segments from chapter text.");
    }

    // Emit the initial chunk total so the frontend sees the total
    // immediately ("0/3" instead of first "1/1", later "1/3").
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
      const plainText = announcement
        ? `${announcement}.\n\n${paragraphText}`
        : paragraphText;

      // Hash-based cache key: when text, voice, or rate change the
      // hash moves and an old file is ignored. The hash is
      // deliberately NOT a timestamp — same input = same file.
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
    // Silence pads: ~250 ms between chunks give Qwen a "thinking
    // pause" between paragraph groups (the model ignores \n\n and
    // would otherwise rattle through). ~900 ms at chapter end
    // provides the break before the next chapter — also for intros
    // (otherwise the intro text flows seamlessly into chapter 1).
    await concatMp3WithGaps(chunkFiles, mergedPath, {
      interChunkMs: 250,
      trailingMs: 900,
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
    // Only clean up on success. On failure KEEP — the user can
    // trigger retry and lands straight in the cache-read loop.
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

/** Deterministic 8-char hash per chunk (text + voice + rate +
 *  chapter + index). When any of these inputs change the chunk gets
 *  a new cache key and is regenerated. */
function chunkHash(input: {
  text: string;
  voice: string;
  rate: string;
  chapterId: string;
  index: number;
}): string {
  return createHash("sha256")
    .update(
      `${input.text}|${input.voice}|${input.rate}|${input.chapterId}|${input.index}`
    )
    .digest("hex")
    .slice(0, 8);
}


function coverPathFor(docId: string): string | undefined {
  // pdftoppm writes "{base}-1.jpg" (single-digit) for single-page renders.
  for (const candidate of [
    pathJoin(DATA_DIR, "covers", `${docId}-1.jpg`),
    pathJoin(DATA_DIR, "covers", `${docId}-01.jpg`),
    pathJoin(DATA_DIR, "covers", `${docId}.jpg`),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function documentTitle(docId: string): Promise<string> {
  const row = db().prepare("SELECT title FROM documents WHERE id = ?").get(docId) as
    | { title: string }
    | undefined;
  return row?.title ?? "PageMentor";
}

function relPath(abs: string): string {
  return abs.startsWith(DATA_DIR + "/") || abs.startsWith(DATA_DIR + "\\")
    ? abs.slice(DATA_DIR.length + 1)
    : abs;
}

function chapterFile(dir: string, ch: Chapter): string {
  return join(dir, `chapter-${String(ch.number).padStart(3, "0")}-${ch.id}.mp3`);
}

function upsertAudio(params: {
  chapterId: string;
  storedRelPath: string;
  durationMs: number;
  voice: string;
  engine: EngineId;
  status: "done" | "failed" | "running" | "pending";
}): void {
  const d = db();
  const existing = d.prepare("SELECT id FROM audio WHERE chapter_id = ?").get(params.chapterId) as
    | { id: string }
    | undefined;
  if (existing) {
    d.prepare(
      "UPDATE audio SET stored_path = ?, duration_ms = ?, engine = ?, voice = ?, status = ? WHERE chapter_id = ?"
    ).run(
      params.storedRelPath,
      params.durationMs,
      params.engine,
      params.voice,
      params.status,
      params.chapterId
    );
  } else {
    d.prepare(
      "INSERT INTO audio (id, chapter_id, stored_path, duration_ms, engine, voice, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      randomUUID(),
      params.chapterId,
      params.storedRelPath,
      params.durationMs,
      params.engine,
      params.voice,
      params.status
    );
  }
}

/** Removes the audio row + MP3 file for a single chapter. Called
 *  when a synthesis fails so the library doesn't keep a dead failed
 *  entry around. */
function deleteAudioForChapter(chapterId: string, chapterFilePath: string): void {
  try {
    if (existsSync(chapterFilePath)) rmSync(chapterFilePath, { force: true });
  } catch {
    // best effort
  }
  db().prepare("DELETE FROM audio WHERE chapter_id = ?").run(chapterId);
}

/** Removes all generated audiobook files for a document. */
export function clearAudio(docId: string): void {
  const dir = join(DATA_DIR, "audio", docId);
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      rmSync(full, { recursive: true, force: true });
    }
  }
  db().prepare(
    `DELETE FROM audio WHERE chapter_id IN (SELECT id FROM chapters WHERE document_id = ?)`
  ).run(docId);
}

/** Removes a single chapter audio file + DB row. The book M4B is
 *  also discarded because it would otherwise reference a track that
 *  no longer exists. */
export function clearAudioForChapter(audioId: string): boolean {
  const d = db();
  const row = d
    .prepare(
      `SELECT a.id, a.stored_path, c.document_id
       FROM audio a JOIN chapters c ON c.id = a.chapter_id
       WHERE a.id = ?`
    )
    .get(audioId) as { id: string; stored_path: string; document_id: string } | undefined;
  if (!row) return false;

  const fullPath = join(DATA_DIR, row.stored_path);
  if (existsSync(fullPath)) {
    try {
      rmSync(fullPath, { force: true });
    } catch {
      // best effort — DB row is removed regardless so the UI cleans up
    }
  }

  const bookPath = join(DATA_DIR, "audio", row.document_id, "book.m4b");
  if (existsSync(bookPath)) {
    try {
      rmSync(bookPath, { force: true });
    } catch {
      // best effort
    }
  }

  d.prepare("DELETE FROM audio WHERE id = ?").run(audioId);
  return true;
}

/** Builds an M4B from all existing chapter MP3s of the document.
 *  Called by the UI when the user generated per chapter and wants a
 *  full download afterwards. */
export async function rebuildM4B(docId: string): Promise<{
  path: string;
  chapters: number;
}> {
  const d = db();
  const doc = d
    .prepare(
      `SELECT d.id, d.title, d.doc_title, d.author, d.short_code, d.language,
              m.name AS module_name
       FROM documents d
       LEFT JOIN modules m ON m.id = d.module_id
       WHERE d.id = ?`
    )
    .get(docId) as Document | undefined;
  if (!doc) throw new Error("Document not found");

  const audioDir = join(DATA_DIR, "audio", docId);
  mkdirSync(audioDir, { recursive: true });

  // Collect all done audio files in chapter order.
  const rows = d
    .prepare(
      `SELECT a.stored_path, c.title, a.duration_ms, c.number, c.sort_order
       FROM audio a
       JOIN chapters c ON c.id = a.chapter_id
       WHERE c.document_id = ? AND a.status = 'done'
       ORDER BY c.sort_order ASC, c.number ASC`
    )
    .all(docId) as Array<{
    stored_path: string;
    title: string | null;
    duration_ms: number;
    number: number;
    sort_order: number;
  }>;

  const lang = pickLang(doc.language);

  if (rows.length === 0) {
    throw new Error(tLang(lang, "err.noFinishedAudio"));
  }

  const inputs: string[] = [];
  const m4bChapters: Array<{ title: string; durationMs: number }> = [];

  const introPath = join(audioDir, "intro.mp3");
  if (existsSync(introPath)) {
    inputs.push(introPath);
    m4bChapters.push({ title: tLang(lang, "label.intro"), durationMs: 0 });
  }

  for (const r of rows) {
    const full = join(DATA_DIR, r.stored_path);
    if (!existsSync(full)) continue;
    inputs.push(full);
    m4bChapters.push({
      title: r.title || chapterLabel(lang, r.number),
      durationMs: r.duration_ms,
    });
  }

  if (inputs.length === 0) {
    throw new Error(tLang(lang, "err.allAudioMissing"));
  }

  const bookPath = join(audioDir, "book.m4b");
  let lastRebuildEmit = 0;
  await buildM4B({
    inputs,
    chapters: m4bChapters,
    output: bookPath,
    title: doc.doc_title || doc.title,
    artist: doc.author ?? undefined,
    shortCode: doc.short_code ?? undefined,
    series: doc.module_name ?? undefined,
    coverPath: await ensureCover(doc.id),
    onProgress: (currentMs, totalMs) => {
      const now = Date.now();
      if (now - lastRebuildEmit < 500 && currentMs < totalMs) return;
      lastRebuildEmit = now;
      emit({
        phase:
          currentMs === 0
            ? "audiobook.m4b.start"
            : "audiobook.m4b.progress",
        docId,
        current: currentMs,
        total: totalMs,
      });
    },
  });
  emit({
    phase: "audiobook.m4b.done",
    docId,
    current: 1,
    total: 1,
  });

  return { path: bookPath, chapters: m4bChapters.length };
}

