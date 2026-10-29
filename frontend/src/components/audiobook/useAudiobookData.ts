// Zustand des Hörbuch-Tabs: Laden, Stimmen, SSE-Fortschritt
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  subscribeProgress,
  type AudioDocument,
  type ChapterAudioStatus,
  type ProgressEvent,
  type Voice,
} from "../../lib/api";
import { useToast } from "../ui/Toast";
import { getSettings } from "../../lib/settings";
import { t } from "../../lib/i18n";
import { isChapterIncluded } from "./helpers";

export function useAudiobookData(docId: string, documentLanguage: string) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [rate, setRate] = useState(() => getSettings().defaultRate || "+0%");
  const [state, setState] = useState<AudioDocument | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [chapterProgress, setChapterProgress] = useState<Map<string, ProgressEvent>>(new Map());
  const [m4bProgress, setM4bProgress] = useState<
    { currentMs: number; totalMs: number } | null
  >(null);
  const [bookProgress, setBookProgress] = useState<{
    totalChapters: number;
    currentChapter: number;
    chunkCurrent: number;
    chunkTotal: number;
    startedAt: number;
    // Zeichen pro gewähltem Kapitel, Basis der Restzeit
    chapterChars: number[];
  } | null>(null);
  const [elapsedTick, setElapsedTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [chapterStatus, setChapterStatus] = useState<ChapterAudioStatus[]>([]);
  const [intro, setIntro] = useState<{
    text: string | null;
    audioUrl: string | null;
    docMeta: {
      title: string;
      author: string | null;
      language: string;
    } | null;
  }>({ text: null, audioUrl: null, docMeta: null });
  const [introBusy, setIntroBusy] = useState(false);
  const [kindBulkBusy, setKindBulkBusy] = useState<string | null>(null);
  const [busyChapter, setBusyChapter] = useState<
    Record<string, "preprocess" | "generate" | undefined>
  >({});
  const [editChapterId, setEditChapterId] = useState<string | null>(null);
  const [editIntroOpen, setEditIntroOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [m4bBusy, setM4bBusy] = useState(false);
  const [absBusy, setAbsBusy] = useState(false);
  const [absConfigured, setAbsConfigured] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  // Hörprobe beim Verlassen stoppen
  useEffect(() => {
    return () => {
      previewAudioRef.current?.pause();
      previewAudioRef.current = null;
    };
  }, []);
  // Aktueller chapterStatus für den SSE-Handler
  const chapterStatusRef = useRef<ChapterAudioStatus[]>([]);
  useEffect(() => {
    chapterStatusRef.current = chapterStatus;
  }, [chapterStatus]);
  const toast = useToast();

  const loadChapterStatus = useCallback(async () => {
    try {
      const res = await api.audio.chapterStatus(docId);
      setChapterStatus(res.chapters);
      if (res.intro) setIntro(res.intro);
    } catch {
      // Still: kurze Ausfälle beim Neuladen nicht melden
    }
  }, [docId]);

  // Erstes Laden
  useEffect(() => {
    loadChapterStatus();
  }, [loadChapterStatus]);

  // Fortschritt nach Reload vom Backend holen
  useEffect(() => {
    api.audio
      .progress(docId)
      .then((p) => {
        if (p.running) {
          setBookProgress({
            totalChapters: p.totalChapters,
            currentChapter: p.currentChapter,
            chunkCurrent: p.chunkCurrent,
            chunkTotal: p.chunkTotal,
            startedAt: p.startedAt,
            chapterChars: p.chapterChars,
          });
        }
      })
      .catch(() => {
        // Backend fährt evtl. noch hoch, Panel füllt sich per SSE
      });
  }, [docId]);
  useEffect(() => {
    const loadVoicesAndState = () => {
      Promise.all([api.audio.voices(), api.audio.get(docId)])
        .then(([v, a]) => {
          setVoices(v.voices);
          setState(a);
          const settings = getSettings();
          const langVoices = v.voices.filter(
            (vc) => vc.language === documentLanguage
          );
          const fromSettings =
            settings.defaultVoice &&
            v.voices.find((vc) => vc.id === settings.defaultVoice)
              ? settings.defaultVoice
              : null;
          const preferred =
            fromSettings ??
            langVoices.find((vc) => vc.flagship)?.id ??
            langVoices[0]?.id ??
            v.voices[0]?.id ??
            "";
          // Auswahl des Nutzers behalten, nur setzen wenn leer oder gelöscht
          setVoiceId((prev) => {
            if (prev && v.voices.some((vc) => vc.id === prev)) return prev;
            return preferred;
          });
        })
        .catch((err) =>
          toast.show(err instanceof Error ? err.message : t("common.error"), "error")
        );
    };
    loadVoicesAndState();
    // Stimmenliste neu laden, wenn Settings pm:voices-changed melden
    const voicesChangedHandler = () => {
      api.audio.voices().then((v) => setVoices(v.voices)).catch(() => {});
    };
    window.addEventListener("pm:voices-changed", voicesChangedHandler);
    // Audiobookshelf-Knopf nur, wenn URL, Key und Bibliothek gesetzt
    api.llmConfig
      .get()
      .then((r) => {
        setAbsConfigured(
          !!(r.config.absEnabled === "1" && r.config.absUrl && r.config.absApiKeyPresent && r.config.absLibraryId)
        );
      })
      .catch(() => setAbsConfigured(false));
    return () => {
      window.removeEventListener("pm:voices-changed", voicesChangedHandler);
    };
    // toast bewusst nicht in den Abhängigkeiten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, documentLanguage]);

  // SSE-Abo
  useEffect(() => {
    const unsubscribe = subscribeProgress(docId, (ev) => {
      setProgress(ev);
      if (ev.chapterId) {
        setChapterProgress((prev) => {
          const next = new Map(prev);
          next.set(ev.chapterId!, ev);
          return next;
        });
      }
      // Buch-Fortschritt aus den Events ableiten
      if (ev.phase === "audiobook.start") {
        // Zeichen der gewählten Kapitel für die Restzeit
        const chapterChars = chapterStatusRef.current
          .filter(isChapterIncluded)
          .map((c) => c.text_length || 0);
        setBookProgress({
          totalChapters: ev.total ?? 0,
          currentChapter: 0,
          chunkCurrent: 0,
          chunkTotal: 0,
          startedAt: Date.now(),
          chapterChars,
        });
      } else if (ev.phase === "audiobook.chapter.start") {
        // Nur weiterzählen, wenn ein Buch-Lauf läuft
        // Einzelkapitel und Intro senden kein audiobook.start
        // Nach SSE-Reconnect nicht raten: kein Panel für Einzelkapitel
        setBookProgress((prev) =>
          prev
            ? {
                ...prev,
                totalChapters: ev.total ?? prev.totalChapters,
                currentChapter: ev.current ?? prev.currentChapter,
                chunkCurrent: 0,
                chunkTotal: 0,
              }
            : null
        );
      } else if (ev.phase === "audiobook.chapter.progress") {
        setBookProgress((prev) => {
          if (prev) {
            return {
              ...prev,
              chunkCurrent: ev.current ?? 0,
              chunkTotal: ev.total ?? 0,
            };
          }
          // Intro (Kapitel 0) ist kein Buch-Lauf: kein Panel, sonst bleibt „Generiere …“ stehen
          if (ev.chapterNumber === 0) return null;
          // Reconnect ohne audiobook.start: zumindest Chunk X / Y zeigen
          return {
            totalChapters: 0,
            currentChapter: 0,
            chunkCurrent: ev.current ?? 0,
            chunkTotal: ev.total ?? 0,
            startedAt: 0,
            chapterChars: [],
          };
        });
      } else if (ev.phase === "audiobook.chapter.done" || ev.phase === "audiobook.chapter.failed") {
        // Ersatz-Panel nach Reconnect (ohne Buch-Lauf) endet mit dem Kapitel
        setBookProgress((prev) =>
          !prev || prev.totalChapters === 0
            ? null
            : ev.phase === "audiobook.chapter.failed"
            ? prev
            : {
                ...prev,
                currentChapter: ev.current ?? prev.currentChapter,
                chunkCurrent: prev.chunkTotal,
              }
        );
      } else if (
        ev.phase === "audiobook.done" ||
        ev.phase === "audiobook.failed" ||
        ev.phase === "audiobook.canceled"
      ) {
        setBookProgress(null);
        // Kapitel-Fortschritt und busy leeren, sonst bleibt Generieren gesperrt
        setChapterProgress(new Map());
        setBusyChapter({});
      }
      // M4B-Fortschritt: aktuelle Position und Gesamtdauer in ms
      if (ev.phase === "audiobook.m4b.start") {
        setM4bProgress({ currentMs: 0, totalMs: ev.total ?? 0 });
      } else if (ev.phase === "audiobook.m4b.progress") {
        setM4bProgress({
          currentMs: ev.current ?? 0,
          totalMs: ev.total ?? 0,
        });
      } else if (ev.phase === "audiobook.m4b.done") {
        setM4bProgress(null);
      }
      if (
        ev.phase === "audiobook.done" ||
        ev.phase === "audiobook.failed" ||
        ev.phase === "audiobook.canceled" ||
        ev.phase === "audiobook.chapter.done" ||
        ev.phase === "audiobook.chapter.failed" ||
        ev.phase === "audiobook.book.building"
      ) {
        // Audio-Liste und Kapitelstatus neu laden
        api.audio.get(docId).then(setState).catch(() => {});
        loadChapterStatus();
      }
    });
    return unsubscribe;
  }, [docId, loadChapterStatus]);
  return {
    voices,
    setVoices,
    voiceId,
    setVoiceId,
    rate,
    setRate,
    state,
    setState,
    progress,
    setProgress,
    chapterProgress,
    setChapterProgress,
    m4bProgress,
    setM4bProgress,
    bookProgress,
    setBookProgress,
    elapsedTick,
    setElapsedTick,
    busy,
    setBusy,
    chapterStatus,
    setChapterStatus,
    intro,
    setIntro,
    introBusy,
    setIntroBusy,
    kindBulkBusy,
    setKindBulkBusy,
    busyChapter,
    setBusyChapter,
    editChapterId,
    setEditChapterId,
    editIntroOpen,
    setEditIntroOpen,
    selectedIds,
    setSelectedIds,
    bulkBusy,
    setBulkBusy,
    m4bBusy,
    setM4bBusy,
    absBusy,
    setAbsBusy,
    absConfigured,
    setAbsConfigured,
    previewAudioRef,
    chapterStatusRef,
    toast,
    loadChapterStatus,
  };
}

export type AudiobookData = ReturnType<typeof useAudiobookData>;
