import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  subscribeProgress,
  type AudioDocument,
  type ChapterAudioStatus,
  type ProgressEvent,
  type Voice,
} from "../lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { cn } from "../lib/cn";
import { getSettings } from "../lib/settings";
import { AudioTextEditModal } from "./AudioTextEditModal";
import { IntroTextEditModal } from "./IntroTextEditModal";
import { t } from "../lib/i18n";

interface Props {
  docId: string;
  documentLanguage: string;
}

/** Rate-Optionen in 5%-Schritten von -10 bis +30. Label direkt im
 *  Component erzeugt, statt pro Schritt eigenen i18n-Key zu pflegen. */
const RATE_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const steps: Array<{ value: string; label: string }> = [];
  for (let pct = -10; pct <= 30; pct += 5) {
    if (pct === 0) {
      steps.push({ value: "+0%", label: "Normal" });
    } else if (pct > 0) {
      steps.push({ value: `+${pct}%`, label: `+${pct} %` });
    } else {
      steps.push({ value: `${pct}%`, label: `−${Math.abs(pct)} %` });
    }
  }
  return steps;
})();

export function Audiobook({ docId, documentLanguage }: Props) {
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
    /** Zeichenanzahl pro inkludiertem Kapitel (Reihenfolge wie im Run).
     *  Dient der ETA-Berechnung: bekannte Zeichen × ms/Zeichen. Wird beim
     *  `audiobook.start` einmal aus chapterStatus berechnet. */
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
  // Snapshot for the SSE handler, which would otherwise see stale
  // chapterStatus (useEffect deps don't keep it fresh). On the
  // `audiobook.start` event chapterCharsRef.current is read.
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
      // Silent — when the endpoint briefly fails (pipeline reload),
      // don't spam with toasts.
    }
  }, [docId]);

  // Initial load: voices + current audio state + per-chapter status
  useEffect(() => {
    loadChapterStatus();
  }, [loadChapterStatus]);

  // Rehydrate bookProgress nach Reload aus dem Backend-Run-State,
  // sodass Status-Panel + ETA + Elapsed nicht auf 0:00 zurückspringen
  // wenn der User die Seite neu lädt während ein Audiobook generiert.
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
        // Backend noch beim Hochfahren oder Endpoint nicht da — kein
        // Fehler, der Status-Bar bleibt halt leer bis SSE kommt.
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
          // Don't overwrite the user's choice — only set initially
          // (when empty) or when the current choice no longer exists
          // (voice was deleted). Prevents the picker from snapping
          // back to default on re-render (toast show, state update).
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
    // Reload the voice list when a voice was created/deleted in
    // Settings. SettingsModal fires `pm:voices-changed`; without
    // this listener the audiobook picker only shows voices that
    // existed when the tab opened.
    const voicesChangedHandler = () => {
      api.audio.voices().then((v) => setVoices(v.voices)).catch(() => {});
    };
    window.addEventListener("pm:voices-changed", voicesChangedHandler);
    // ABS-Config-Check: Upload-Button erscheint nur wenn URL + Key +
    // Library gesetzt sind. Single-fire beim Mount, Reload nach
    // Settings-Save hat der User selbst in der Hand.
    api.llmConfig
      .get()
      .then((r) => {
        setAbsConfigured(
          !!(r.config.absUrl && r.config.absApiKeyPresent && r.config.absLibraryId)
        );
      })
      .catch(() => setAbsConfigured(false));
    return () => {
      window.removeEventListener("pm:voices-changed", voicesChangedHandler);
    };
    // `toast` deliberately not in deps — the error toast is a side
    // effect and doesn't need to retrigger the effect. Voice load
    // depends on doc + language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, documentLanguage]);

  // SSE-Subscription
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
      // Derive book-level progress from the phase events.
      if (ev.phase === "audiobook.start") {
        // Character snapshot of chapters included in the run —
        // forms the basis for the ETA (ms/char × remaining).
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
        // Only advance when a full-book run is already in progress
        // (audiobook.start set bookProgress != null). Single-chapter
        // and intro generates emit chapter.* events without
        // audiobook.start — those should NOT activate the full-book
        // progress panel, otherwise it hangs forever because no
        // audiobook.done ever arrives.
        //
        // Edge-case: SSE reconnect after the SSE buffer evicted the
        // original `audiobook.start`. We don't know if a full-book
        // run is actually running, so play it safe: do NOT auto-init
        // bookProgress here — that would falsely show the panel for
        // a single-chapter generate.
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
          // SSE reconnect after the buffer evicted `audiobook.start`:
          // we have neither startedAt nor the chapterChars list, so
          // ETA stays "—". But re-initialise enough state to at least
          // show "Chunk X / Y" again so the user knows it's running.
          // chapter.start events also re-arrive after a reconnect, so
          // currentChapter is filled in by the next start/done event.
          return {
            totalChapters: 0,
            currentChapter: 0,
            chunkCurrent: ev.current ?? 0,
            chunkTotal: ev.total ?? 0,
            startedAt: 0,
            chapterChars: [],
          };
        });
      } else if (ev.phase === "audiobook.chapter.done") {
        setBookProgress((prev) =>
          prev
            ? {
                ...prev,
                currentChapter: ev.current ?? prev.currentChapter,
                chunkCurrent: prev.chunkTotal,
              }
            : prev
        );
      } else if (
        ev.phase === "audiobook.done" ||
        ev.phase === "audiobook.failed" ||
        ev.phase === "audiobook.canceled"
      ) {
        setBookProgress(null);
        // Auch chapterProgress + busyChapter leeren, sonst bleibt der
        // Generate-Button bei cancel/fail dauerhaft disabled (der
        // letzte chapter.progress-Event hängt sonst in der Map).
        setChapterProgress(new Map());
        setBusyChapter({});
      }
      // M4B encode progress events (SSE from the backend during
      // book build or rebuild). current = current audio position in
      // ms, total = merged MP3 duration in ms. So the user sees how
      // far ffmpeg actually is instead of only reading "builds …".
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
        // Refresh audio list + chapter status so the per-chapter row
        // switches from "running" → "done" without page reload.
        api.audio.get(docId).then(setState).catch(() => {});
        loadChapterStatus();
      }
    });
    return unsubscribe;
  }, [docId, loadChapterStatus]);

  async function generate() {
    if (!voiceId) return;
    setBusy(true);
    try {
      await api.audio.generate(
        docId,
        voiceId,
        rate,
        getSettings().defaultOllamaModel || undefined
      );
      toast.show(t("audiobook.queued"), "success");
      setChapterProgress(new Map());
      setBookProgress(null);
      const refreshed = await api.audio.get(docId);
      setState(refreshed);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadToAbs() {
    setAbsBusy(true);
    try {
      const r = await api.abs.upload(docId);
      const url = r.url;
      toast.show(
        url
          ? t("audiobook.abs.uploaded.withLink")
          : t("audiobook.abs.uploaded"),
        "success"
      );
      if (url) {
        // Open in a new tab so the user sees the item right away.
        window.open(url, "_blank", "noopener");
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setAbsBusy(false);
    }
  }

  async function rebuildM4B() {
    setM4bBusy(true);
    try {
      await api.audio.rebuildM4B(docId);
      const refreshed = await api.audio.get(docId);
      setState(refreshed);
      toast.show(t("audiobook.m4b.built"), "success");
    } catch (err) {
      // Empty error messages (e.g. backend only returns a 4xx status
      // without a body or fetch aborts) → fall back to translation,
      // otherwise the user sees a red toast with no text.
      const msg =
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : t("common.error");
      toast.show(msg, "error");
    } finally {
      setM4bBusy(false);
    }
  }

  async function clearChapter(audioId: string) {
    if (!confirm(t("audiobook.clearChapterConfirm"))) return;
    try {
      await api.audio.clearChapter(audioId);
      // Order matters: pull both the audio list AND per-chapter
      // status from the backend, otherwise the row stays in the UI as
      // "done" because chapterStatus still holds the old audio_id.
      const refreshed = await api.audio.get(docId);
      setState(refreshed);
      await loadChapterStatus();
      toast.show(t("audiobook.cleared"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function cancelRun() {
    if (!confirm(t("audiobook.cancelConfirm"))) return;
    try {
      await api.audio.cancel(docId);
      toast.show(t("audiobook.canceled"), "success");
      // Sofortige UI-Bereinigung: alle Progress-States leeren, sonst
      // bleibt der Generate-Button disabled weil der letzte
      // chapter.progress-Event in der Map weiter als "running" zählt.
      // Das SSE-canceled-Event räumt zwar bookProgress + state auf,
      // aber chapterProgress + busyChapter bleiben bisher hängen.
      setBookProgress(null);
      setChapterProgress(new Map());
      setBusyChapter({});
      setIntroBusy(false);
      // State frisch ziehen — Server hat die Audio-Statusliste bereits
      // aktualisiert (laufende Chapter auf failed gesetzt).
      api.audio.get(docId).then(setState).catch(() => {});
      loadChapterStatus();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  // --- Per-chapter actions ---------------------------------------
  async function preprocessChapter(chapterId: string, force: boolean) {
    setBusyChapter((b) => ({ ...b, [chapterId]: "preprocess" }));
    try {
      const res = await api.audio.preprocessChapter(chapterId, {
        force,
        model: getSettings().defaultOllamaModel || undefined,
      });
      toast.show(
        res.cached
          ? t("audiobook.chapter.preprocess.cached")
          : t("audiobook.chapter.preprocess.done", { model: res.model }),
        "success"
      );
      await loadChapterStatus();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusyChapter((b) => {
        const { [chapterId]: _, ...rest } = b;
        return rest;
      });
    }
  }

  async function saveIntroText(text: string | null) {
    setIntroBusy(true);
    try {
      const res = await api.audio.setIntroText(docId, text);
      setIntro((prev) => ({ ...prev, text: res.text }));
      toast.show(t("audiobook.intro.saved"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setIntroBusy(false);
    }
  }

  async function generateIntroAudio() {
    if (!voiceId) {
      toast.show(t("audiobook.voice.emptyForLang", { lang: documentLanguage }), "error");
      return;
    }
    setIntroBusy(true);
    try {
      await api.audio.generateIntro(
        docId,
        voiceId,
        rate,
        getSettings().defaultOllamaModel || undefined
      );
      toast.show(t("audiobook.intro.queued"), "success");
      // Background job is running, status is updated via SSE.
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setIntroBusy(false);
    }
  }

  async function deleteIntroAudio() {
    if (!confirm(t("audiobook.intro.deleteAudioConfirm"))) return;
    try {
      await api.audio.deleteIntroAudio(docId);
      setIntro((prev) => ({ ...prev, audioUrl: null }));
      toast.show(t("audiobook.intro.audioDeleted"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function preprocessIntro(force: boolean) {
    setIntroBusy(true);
    try {
      const res = await api.audio.preprocessIntro(docId, {
        force,
        model: getSettings().defaultOllamaModel || undefined,
      });
      toast.show(
        res.cached
          ? t("audiobook.intro.preprocessCached")
          : t("audiobook.intro.preprocessDone", { model: res.model }),
        "success"
      );
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setIntroBusy(false);
    }
  }

  async function bulkIncludeByKind(kind: string, include: boolean) {
    setKindBulkBusy(kind);
    // Optimistic — update UI before the backend responds.
    setChapterStatus((prev) =>
      prev.map((c) =>
        c.kind === kind ? { ...c, include_in_audio: include ? 1 : 0 } : c
      )
    );
    try {
      const res = await api.audio.setIncludeByKind(docId, kind, include);
      toast.show(
        t("audiobook.kindFilter.applied", {
          kind: t(`chapters.kind.${kind}`),
          n: res.updated,
        }),
        "success"
      );
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
      await loadChapterStatus(); // rollback
    } finally {
      setKindBulkBusy(null);
    }
  }

  function toggleSelection(chapterId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  }

  function selectAll(includedOnly: boolean) {
    setSelectedIds(
      new Set(
        chapterStatus
          .filter((c) =>
            !includedOnly
              ? true
              : c.include_in_audio == null
              ? c.kind === "content" || c.kind === "summary"
              : c.include_in_audio === 1
          )
          .map((c) => c.chapter_id)
      )
    );
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  /** Sequential preprocess for all selected items. Sequential rather
   *  than parallel because Ollama on a single model only handles one
   *  generate call at a time — parallel calls would just fill the
   *  HTTP queue and risk timeouts. */
  async function bulkPreprocess(force: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const id of ids) {
        setBusyChapter((b) => ({ ...b, [id]: "preprocess" }));
        try {
          await api.audio.preprocessChapter(id, {
            force,
            model: getSettings().defaultOllamaModel || undefined,
          });
          ok++;
        } catch (err) {
          failed++;
          console.warn(`[bulk preprocess] chapter ${id} failed:`, err);
        } finally {
          setBusyChapter((b) => {
            const { [id]: _drop, ...rest } = b;
            return rest;
          });
        }
        // Short pause so the UI can breathe and the status load
        // doesn't collide directly with the next generate call.
        await loadChapterStatus();
      }
      if (failed === 0) {
        toast.show(t("audiobook.bulk.done", { n: ok }), "success");
      } else {
        toast.show(
          t("audiobook.bulk.partialDone", { ok, failed }),
          failed > ok ? "error" : "success"
        );
      }
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  }

  async function toggleInclude(chapterId: string, next: boolean) {
    // Optimistic update — instant UI feedback, rollback on error.
    setChapterStatus((prev) =>
      prev.map((c) =>
        c.chapter_id === chapterId
          ? { ...c, include_in_audio: next ? 1 : 0 }
          : c
      )
    );
    try {
      await api.audio.setInclude(chapterId, next);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
      await loadChapterStatus();
    }
  }

  async function generateChapter(chapterId: string) {
    if (!voiceId) {
      toast.show(t("audiobook.voice.emptyForLang", { lang: documentLanguage }), "error");
      return;
    }
    setBusyChapter((b) => ({ ...b, [chapterId]: "generate" }));
    try {
      await api.audio.generateChapter(
        chapterId,
        voiceId,
        rate,
        getSettings().defaultOllamaModel || undefined
      );
      toast.show(t("audiobook.chapter.generate.queued"), "success");
      await loadChapterStatus();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusyChapter((b) => {
        const { [chapterId]: _, ...rest } = b;
        return rest;
      });
    }
  }

  async function clearAll() {
    if (!confirm(t("audiobook.clearConfirm"))) return;
    try {
      await api.audio.clear(docId);
      const refreshed = await api.audio.get(docId);
      setState(refreshed);
      setChapterProgress(new Map());
      setProgress(null);
      toast.show(t("audiobook.cleared"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  function playPreview() {
    if (!voiceId) return;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
    }
    const audio = new Audio(api.audio.previewUrl(voiceId));
    previewAudioRef.current = audio;
    audio.play().catch(() => toast.show(t("audiobook.previewFailed"), "error"));
  }

  // Counts for the main button label. The backend already skips
  // finished chapters in the audiobook run (v1.18.010); the UI
  // should reflect that honestly instead of saying "Regenerate"
  // while in reality only the missing ones are generated.
  const includedCount = useMemo(
    () => chapterStatus.filter(isChapterIncluded).length,
    [chapterStatus]
  );
  const doneCount = useMemo(
    () =>
      chapterStatus.filter(
        (c) => isChapterIncluded(c) && c.audio_status === "done"
      ).length,
    [chapterStatus]
  );
  const missingCount = Math.max(0, includedCount - doneCount);

  const langVoices = useMemo(
    () =>
      voices
        .filter((v) => v.language === documentLanguage)
        .sort(compareVoices),
    [voices, documentLanguage]
  );
  const otherVoices = useMemo(
    () =>
      voices
        .filter((v) => v.language !== documentLanguage)
        .sort(compareVoices),
    [voices, documentLanguage]
  );

  // Terminal phases must NOT keep `generating` true anymore —
  // otherwise the Generate button stays disabled after a failure.
  const progressIsTerminal =
    progress?.phase === "audiobook.done" ||
    progress?.phase === "audiobook.failed" ||
    progress?.phase === "audiobook.canceled";
  // "in flight" only when a full-book run is active (bookProgress
  // set). Single-chapter or intro generates also emit chapter
  // start/done events, but those are NOT a full-book run —
  // otherwise the Generate button would stay disabled until the next
  // doc switch. The per-chapter "busy" state already shows that in
  // the row.
  const progressIsInFlight =
    !!bookProgress &&
    progress?.phase.startsWith("audiobook.") === true &&
    !progressIsTerminal;
  // Single-chapter and intro generates also count as "something is
  // running" — otherwise the user wouldn't see a Cancel button after
  // generating a single chapter that then gets stuck. We derive
  // "active chapter" from the SSE chapter.* events: as long as a
  // chapter is in start/progress phase (i.e. not done/failed/
  // canceled) something is running on the backend.
  const anyChapterSynthRunning = Array.from(chapterProgress.values()).some(
    (ev) =>
      ev.phase === "audiobook.chapter.start" ||
      ev.phase === "audiobook.chapter.progress" ||
      ev.phase === "audiobook.chapter.preprocess"
  );
  const anyChapterBusy = Object.values(busyChapter).some(
    (s) => s === "generate"
  );
  const generating =
    (state?.generating ?? false) ||
    progressIsInFlight ||
    anyChapterSynthRunning ||
    anyChapterBusy ||
    introBusy;
  const phaseMessage = progress ? describePhase(progress) : null;

  // Tick once per second so runtime + remaining keep counting
  // visibly (the book progress state itself only changes on SSE events).
  useEffect(() => {
    if (!bookProgress) return;
    const iv = setInterval(() => setElapsedTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [bookProgress]);
  void elapsedTick;

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">{t("audiobook.title")}</h2>
            <p className="text-xs text-neutral-500 mt-1">{t("audiobook.subtitle")}</p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {state?.book && !m4bProgress && (
              <a href={state.book.url} className="btn-outline" download>
                {t("audiobook.download.m4b")}
              </a>
            )}
            {(state?.audio.filter((a) => a.status === "done").length ?? 0) > 0 && (
              <Button
                variant="outline"
                onClick={rebuildM4B}
                disabled={m4bBusy || !!m4bProgress}
                title={
                  state?.book
                    ? t("audiobook.m4b.rebuildTooltip")
                    : t("audiobook.m4b.buildTooltip")
                }
              >
                {m4bBusy || m4bProgress
                  ? t("audiobook.m4b.building")
                  : state?.book
                  ? t("audiobook.m4b.rebuild")
                  : t("audiobook.m4b.build")}
              </Button>
            )}
            {state?.book && !m4bProgress && absConfigured && (
              <Button
                variant="outline"
                onClick={uploadToAbs}
                disabled={absBusy}
                title={t("audiobook.abs.uploadTooltip")}
              >
                {absBusy
                  ? t("audiobook.abs.uploading")
                  : t("audiobook.abs.upload")}
              </Button>
            )}
            {m4bProgress && m4bProgress.totalMs > 0 && (
              <div className="flex items-center gap-2 min-w-[220px]">
                <div className="flex-1 h-2 bg-bg-elevated rounded overflow-hidden">
                  <div
                    className="h-full bg-accent transition-[width] duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        (m4bProgress.currentMs / m4bProgress.totalMs) * 100
                      ).toFixed(1)}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-neutral-400 font-mono tabular-nums">
                  {(
                    (m4bProgress.currentMs / m4bProgress.totalMs) *
                    100
                  ).toFixed(0)}
                  %
                </span>
              </div>
            )}
            {(state?.audio.length ?? 0) > 0 && (
              <Button variant="danger" onClick={clearAll}>
                {t("audiobook.clear")}
              </Button>
            )}
          </div>
        </div>

        {bookProgress && (
          <BookProgressPanel
            progress={bookProgress}
            benchmarkMsPerChar={
              voices.find((v) => v.id === voiceId)?.msPerChar ?? null
            }
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
          <div>
            <label className="text-xs font-medium text-neutral-400 block mb-2">
              {t("audiobook.voice")}
            </label>
            {langVoices.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {langVoices.map((v) => (
                  <VoiceChip
                    key={v.id}
                    voice={v}
                    active={voiceId === v.id}
                    onSelect={() => setVoiceId(v.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-500">
                {t("audiobook.voice.emptyForLang", { lang: documentLanguage })}
              </p>
            )}
            {otherVoices.length > 0 && (
              <details className="mt-3">
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">
                  {t("audiobook.voice.more", { n: otherVoices.length })}
                </summary>
                <div className="flex flex-wrap gap-2 mt-2">
                  {otherVoices.map((v) => (
                    <VoiceChip
                      key={v.id}
                      voice={v}
                      active={voiceId === v.id}
                      onSelect={() => setVoiceId(v.id)}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>

          <div className="flex flex-col gap-3 md:min-w-[180px]">
            <div>
              <label className="text-xs font-medium text-neutral-400 block mb-2">
                {t("audiobook.rate")}
              </label>
              <select
                className="input"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              >
                {RATE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.value === "+0%" ? t("rate.0") : r.label}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={playPreview} disabled={!voiceId}>
              {t("audiobook.preview")}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <Button
            onClick={generate}
            disabled={
              busy ||
              generating ||
              !voiceId ||
              (includedCount > 0 && missingCount === 0)
            }
          >
            {generating
              ? t("audiobook.generating")
              : includedCount === 0
              ? t("audiobook.generate")
              : missingCount === 0
              ? t("audiobook.allDone")
              : doneCount === 0
              ? t("audiobook.generate")
              : t("audiobook.generateMissing", { n: missingCount })}
          </Button>
          {generating && (
            <Button variant="danger" onClick={cancelRun}>
              {t("audiobook.cancel")}
            </Button>
          )}
          {phaseMessage && (
            <span className="text-xs text-neutral-400 truncate">{phaseMessage}</span>
          )}
        </div>
      </section>

      <IntroEditor
        intro={intro}
        voice={voices.find((v) => v.id === voiceId) ?? null}
        modelName={getSettings().defaultOllamaModel}
        busy={introBusy}
        canGenerate={!!voiceId}
        onSave={saveIntroText}
        onGenerate={generateIntroAudio}
        onDeleteAudio={deleteIntroAudio}
        onPreprocess={preprocessIntro}
        onEditTts={() => setEditIntroOpen(true)}
      />

      <KindFilterBar
        chapters={chapterStatus}
        busy={kindBulkBusy}
        onToggle={bulkIncludeByKind}
      />

      <ChapterWorkbench
        chapters={chapterStatus}
        chapterProgress={chapterProgress}
        busyChapter={busyChapter}
        bulkBusy={bulkBusy}
        selectedIds={selectedIds}
        disabled={!voiceId}
        onPreprocess={preprocessChapter}
        onEdit={(id) => setEditChapterId(id)}
        onGenerate={generateChapter}
        onClearChapter={clearChapter}
        onToggleInclude={toggleInclude}
        onToggleSelect={toggleSelection}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBulkPreprocess={bulkPreprocess}
      />

      {editChapterId && (
        <AudioTextEditModal
          chapterId={editChapterId}
          onClose={() => setEditChapterId(null)}
          onSaved={() => {
            setEditChapterId(null);
            loadChapterStatus();
          }}
        />
      )}

      {editIntroOpen && (
        <IntroTextEditModal
          docId={docId}
          onClose={() => setEditIntroOpen(false)}
          onSaved={() => setEditIntroOpen(false)}
        />
      )}

    </div>
  );
}

function VoiceChip({
  voice,
  active,
  onSelect,
}: {
  voice: Voice;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-1 px-3 py-2 rounded-lg border text-left transition-colors",
        active
          ? "border-accent bg-accent/10"
          : "border-border hover:border-border-strong hover:bg-bg-hover"
      )}
      title={voice.note ?? undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-neutral-100">{voice.label}</span>
        {voice.flagship && (
          <span className="tag-accent text-[10px]">{t("audiobook.voice.top")}</span>
        )}
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300">
          {t("audiobook.engine.qwen")}
        </span>
      </div>
      <span className="text-[11px] text-neutral-500">
        {voice.gender === "female" ? "♀" : "♂"} · {voice.locale}
      </span>
    </button>
  );
}

/** Stimmen sortieren: Flagship vor non-Flagship, dann alphabetisch. */
function compareVoices(a: Voice, b: Voice): number {
  if (!!a.flagship !== !!b.flagship) return a.flagship ? -1 : 1;
  return a.label.localeCompare(b.label);
}

/** Default-include pro kind — muss mit der Backend-Logik in
 *  `defaultIncludeForKind()` synchron bleiben. */
function defaultIncludeFor(kind: string): boolean {
  return kind === "content" || kind === "summary";
}
function isChapterIncluded(c: ChapterAudioStatus): boolean {
  if (c.include_in_audio == null) return defaultIncludeFor(c.kind);
  return c.include_in_audio === 1;
}

function ChapterWorkbench({
  chapters,
  chapterProgress,
  busyChapter,
  bulkBusy,
  selectedIds,
  disabled,
  onPreprocess,
  onEdit,
  onGenerate,
  onClearChapter,
  onToggleInclude,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onBulkPreprocess,
}: {
  chapters: ChapterAudioStatus[];
  chapterProgress: Map<string, ProgressEvent>;
  busyChapter: Record<string, "preprocess" | "generate" | undefined>;
  bulkBusy: boolean;
  selectedIds: Set<string>;
  disabled: boolean;
  onPreprocess: (chapterId: string, force: boolean) => void;
  onEdit: (chapterId: string) => void;
  onGenerate: (chapterId: string) => void;
  onClearChapter: (audioId: string) => void;
  onToggleInclude: (chapterId: string, next: boolean) => void;
  onToggleSelect: (chapterId: string) => void;
  onSelectAll: (includedOnly: boolean) => void;
  onClearSelection: () => void;
  onBulkPreprocess: (force: boolean) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (chapters.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-neutral-500">
        {t("audiobook.chaptersEmpty")}
      </div>
    );
  }
  const visible = showAll
    ? chapters
    : chapters.filter((c) => isChapterIncluded(c));
  const hiddenCount = chapters.length - visible.length;
  const includedCount = chapters.filter(isChapterIncluded).length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">{t("audiobook.chapters.title")}</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t("audiobook.chapters.hint")}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-neutral-500">
            {t("audiobook.chapters.includedCount", {
              n: includedCount,
              total: chapters.length,
            })}
          </span>
          {hiddenCount > 0 && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="text-accent hover:underline"
            >
              {t("audiobook.chapters.showAll", { n: hiddenCount })}
            </button>
          )}
          {showAll && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="text-neutral-400 hover:text-accent"
            >
              {t("audiobook.chapters.hideExcluded")}
            </button>
          )}
        </div>
      </div>
      {selectedIds.size > 0 ? (
        <div className="card p-3 flex items-center gap-2 flex-wrap bg-bg-elevated border-accent-subtle sticky top-14 z-20">
          <span className="text-sm text-neutral-200 font-medium">
            {t("audiobook.bulk.selected", { n: selectedIds.size })}
          </span>
          <div className="flex-1" />
          <Button
            variant="outline"
            onClick={() => onBulkPreprocess(false)}
            disabled={bulkBusy}
          >
            {bulkBusy
              ? t("audiobook.bulk.busy")
              : t("audiobook.bulk.preprocess")}
          </Button>
          <Button
            variant="outline"
            onClick={() => onBulkPreprocess(true)}
            disabled={bulkBusy}
          >
            {t("audiobook.bulk.preprocessForce")}
          </Button>
          <Button variant="ghost" onClick={onClearSelection} disabled={bulkBusy}>
            {t("audiobook.bulk.clear")}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span>{t("audiobook.bulk.hint")}</span>
          <button
            type="button"
            onClick={() => onSelectAll(true)}
            className="text-accent hover:underline"
          >
            {t("audiobook.bulk.selectIncluded")}
          </button>
          <button
            type="button"
            onClick={() => onSelectAll(false)}
            className="text-accent hover:underline"
          >
            {t("audiobook.bulk.selectAll")}
          </button>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {visible.map((ch) => (
          <ChapterRow
            key={ch.chapter_id}
            chapter={ch}
            progress={chapterProgress.get(ch.chapter_id) ?? null}
            busy={busyChapter[ch.chapter_id]}
            disabled={disabled}
            included={isChapterIncluded(ch)}
            selected={selectedIds.has(ch.chapter_id)}
            onPreprocess={(force) => onPreprocess(ch.chapter_id, force)}
            onEdit={() => onEdit(ch.chapter_id)}
            onGenerate={() => onGenerate(ch.chapter_id)}
            onClear={() =>
              ch.audio_id ? onClearChapter(ch.audio_id) : undefined
            }
            onToggleInclude={(next) => onToggleInclude(ch.chapter_id, next)}
            onToggleSelect={() => onToggleSelect(ch.chapter_id)}
          />
        ))}
      </ul>
    </section>
  );
}

function ChapterRow({
  chapter,
  progress,
  busy,
  disabled,
  included,
  selected,
  onPreprocess,
  onEdit,
  onGenerate,
  onClear,
  onToggleInclude,
  onToggleSelect,
}: {
  chapter: ChapterAudioStatus;
  progress: ProgressEvent | null;
  busy: "preprocess" | "generate" | undefined;
  disabled: boolean;
  included: boolean;
  selected: boolean;
  onPreprocess: (force: boolean) => void;
  onEdit: () => void;
  onGenerate: () => void;
  onClear: () => void;
  onToggleInclude: (next: boolean) => void;
  onToggleSelect: () => void;
}) {
  const phase = progress?.phase;
  const ttsRunning =
    phase === "audiobook.chapter.start" ||
    phase === "audiobook.chapter.progress";
  const ttsFailed =
    chapter.audio_status === "failed" || phase === "audiobook.chapter.failed";
  const audioDone =
    chapter.audio_id != null && chapter.audio_status === "done";
  const cleaned = chapter.audio_text_length != null && chapter.audio_text_length > 0;
  const manualEdit = chapter.audio_text_model === "manual-edit";

  return (
    <li
      className={cn(
        "card p-4 flex flex-col gap-3 transition-opacity",
        !included && !selected && "opacity-50",
        selected && "ring-1 ring-accent/60 bg-accent/5"
      )}
    >
      <div className="flex items-start gap-3">
        <label
          className="flex items-center pt-1 cursor-pointer"
          title={
            included
              ? t("audiobook.chapter.include.on")
              : t("audiobook.chapter.include.off")
          }
        >
          <input
            type="checkbox"
            checked={included}
            onChange={(e) => onToggleInclude(e.target.checked)}
            className="w-4 h-4 accent-accent cursor-pointer"
          />
        </label>
        <label
          className="flex items-center pt-1 cursor-pointer"
          title={t("audiobook.chapter.select.tooltip")}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="w-4 h-4 cursor-pointer accent-sky-400"
          />
        </label>
        <div className="font-mono text-sm text-accent min-w-[2ch] text-right pt-1">
          {String(chapter.number).padStart(2, "0")}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-neutral-100 truncate">
            {chapter.title || `${t("audiobook.chapters.fallback")} ${chapter.number}`}
          </h3>
          <div className="flex items-center gap-2 text-[11px] text-neutral-500 mt-1 flex-wrap">
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide",
                chapter.kind === "content"
                  ? "bg-neutral-700 text-neutral-300"
                  : chapter.kind === "summary"
                  ? "bg-emerald-700/40 text-emerald-200"
                  : chapter.kind === "example"
                  ? "bg-blue-700/40 text-blue-200"
                  : chapter.kind === "exercise" || chapter.kind === "self_check"
                  ? "bg-amber-700/40 text-amber-200"
                  : chapter.kind === "solutions"
                  ? "bg-purple-700/40 text-purple-200"
                  : "bg-neutral-800 text-neutral-500"
              )}
            >
              {t(`chapters.kind.${chapter.kind}`)}
            </span>
            <span>{t("chapters.chars", { n: chapter.text_length })}</span>
            <span>·</span>
            <span>
              {t("chapters.pages")} {chapter.start_page}
              {chapter.end_page !== chapter.start_page && `–${chapter.end_page}`}
            </span>
            {cleaned && (
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px]",
                  manualEdit
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-emerald-500/15 text-emerald-300"
                )}
                title={
                  manualEdit
                    ? t("audiobook.chapter.badge.manualTitle")
                    : t("audiobook.chapter.badge.cleanedTitle", {
                        model: chapter.audio_text_model ?? "?",
                      })
                }
              >
                {manualEdit
                  ? t("audiobook.chapter.badge.manual")
                  : t("audiobook.chapter.badge.cleaned")}
              </span>
            )}
            {audioDone && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/15 text-accent">
                {formatDuration(chapter.duration_ms ?? 0)} · {chapter.voice}
              </span>
            )}
            {ttsFailed && !ttsRunning && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-300">
                {t("audiobook.chapterFailed")}
              </span>
            )}
            {ttsRunning && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/15 text-accent animate-pulse">
                {t("audiobook.chapterPartsRunning", {
                  current: progress?.current ?? 1,
                  total: progress?.total ?? "?",
                })}
              </span>
            )}
          </div>
        </div>
        {audioDone && chapter.audio_id && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-neutral-500 hover:text-accent flex-shrink-0"
            title={t("audiobook.clearChapter")}
            aria-label={t("audiobook.clearChapter")}
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          onClick={() => onPreprocess(cleaned)}
          disabled={busy != null}
        >
          {busy === "preprocess"
            ? t("audiobook.chapter.actions.preprocessBusy")
            : cleaned
            ? t("audiobook.chapter.actions.preprocessAgain")
            : t("audiobook.chapter.actions.preprocess")}
        </Button>
        <Button variant="outline" onClick={onEdit} disabled={busy != null}>
          {cleaned
            ? t("audiobook.chapter.actions.viewEdit")
            : t("audiobook.chapter.actions.viewOriginal")}
        </Button>
        <Button
          onClick={onGenerate}
          disabled={busy != null || disabled || ttsRunning}
        >
          {busy === "generate"
            ? t("audiobook.chapter.actions.generateBusy")
            : audioDone
            ? t("audiobook.chapter.actions.regenerate")
            : t("audiobook.chapter.actions.generate")}
        </Button>
        {audioDone && chapter.audio_id && (
          <a
            href={api.audio.fileUrl(chapter.audio_id)}
            download
            className="text-xs text-neutral-400 hover:text-accent"
          >
            {t("audiobook.downloadMp3")}
          </a>
        )}
      </div>

      {audioDone && chapter.audio_id && (
        <audio
          controls
          preload="none"
          src={api.audio.fileUrl(chapter.audio_id)}
          className="w-full accent-accent [color-scheme:dark]"
        />
      )}
      {ttsRunning && progress?.current && progress?.total && (
        <div className="h-1 bg-bg-elevated rounded overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
        </div>
      )}
    </li>
  );
}

function describePhase(ev: ProgressEvent): string {
  switch (ev.phase) {
    case "pipeline.extract":
      return t("phase.pipeline.extract");
    case "pipeline.chapters":
      return ev.message ?? t("phase.pipeline.chapters");
    case "pipeline.done":
      return t("phase.pipeline.done");
    case "pipeline.failed":
      return t("phase.pipeline.failed", { msg: ev.message ?? "" });
    case "audiobook.start":
      return ev.message ?? t("phase.audiobook.start", { total: ev.total ?? 0 });
    case "audiobook.chapter.preprocess":
      return t("phase.audiobook.chapter.preprocess", {
        current: ev.current ?? 0,
        total: ev.total ?? 0,
      });
    case "audiobook.chapter.start":
      return t("phase.audiobook.chapter.start", {
        current: ev.current ?? 0,
        total: ev.total ?? 0,
        msg: ev.message ?? "",
      });
    case "audiobook.chapter.progress":
      return t("phase.audiobook.chapter.progress", {
        num: ev.chapterNumber ?? 0,
        current: ev.current ?? 0,
        total: ev.total ?? 0,
      });
    case "audiobook.chapter.done":
      return t("phase.audiobook.chapter.done", {
        current: ev.current ?? 0,
        total: ev.total ?? 0,
      });
    case "audiobook.chapter.failed":
      return t("phase.audiobook.chapter.failed", {
        num: ev.chapterNumber ?? 0,
        msg: ev.message ?? "",
      });
    case "audiobook.book.building":
      return t("phase.audiobook.book.building");
    case "audiobook.done":
      return t("phase.audiobook.done");
    case "audiobook.failed":
      return t("phase.audiobook.failed", { msg: ev.message ?? "" });
    default:
      return ev.message ?? "";
  }
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm >= 60) {
    const hh = Math.floor(mm / 60);
    return `${hh}:${String(mm % 60).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function BookProgressPanel({
  progress,
  benchmarkMsPerChar,
}: {
  progress: {
    totalChapters: number;
    currentChapter: number;
    chunkCurrent: number;
    chunkTotal: number;
    startedAt: number;
    chapterChars: number[];
  };
  /** Backend-measured EMA average for the chosen voice. Used as a
   *  starting value for the ETA before the current run has enough
   *  measurements of its own. `null` → first generation with this
   *  voice; we don't show an ETA until enough data exists. */
  benchmarkMsPerChar: number | null;
}) {
  const {
    totalChapters,
    currentChapter,
    chunkCurrent,
    chunkTotal,
    startedAt,
    chapterChars,
  } = progress;
  // startedAt === 0 happens after an SSE reconnect that missed the
  // original `audiobook.start` event (e.g. user left the tab and
  // came back). We don't know when the run actually started, so
  // suppress the elapsed counter rather than show "57 years ago".
  const elapsedMs = startedAt > 0 ? Date.now() - startedAt : null;

  // Total chars + chars done so far.
  const totalChars = chapterChars.reduce((a, b) => a + b, 0);

  // Finished chapters up to currentChapter-1 (exclusive) count fully.
  const completedIdx = Math.max(0, currentChapter - 1);
  const completedChars = chapterChars
    .slice(0, completedIdx)
    .reduce((a, b) => a + b, 0);

  // Current chapter counted proportionally via chunks.
  const currentChapterTotal =
    currentChapter >= 1 && currentChapter <= chapterChars.length
      ? chapterChars[currentChapter - 1]
      : 0;
  const chapterFrac = chunkTotal > 0 ? chunkCurrent / chunkTotal : 0;
  const charsDone = completedChars + currentChapterTotal * chapterFrac;
  const charsRemaining = Math.max(0, totalChars - charsDone);

  // Rate choice: live when we have enough data of our own, otherwise
  // the backend benchmark. Threshold 800 chars = usually ≥ 1 chunk
  // done → enough to lift the live measurement above noise.
  const liveRate =
    elapsedMs !== null && charsDone >= 800 ? elapsedMs / charsDone : null;
  const rate = liveRate ?? benchmarkMsPerChar;

  const etaMs =
    rate !== null ? Math.max(0, Math.round(charsRemaining * rate)) : null;

  // Show the rate in chars/min — at the typical 10-50 chars/sec
  // sec-resolution gave choppy single-digit numbers. min-resolution
  // is more readable and matches user mental model ("X Zeichen pro
  // Minute").
  const charsPerMin =
    rate !== null && rate > 0 ? Math.round(60_000 / rate) : null;

  return (
    <div className="card p-4 bg-bg-elevated flex flex-col gap-2 border-accent-subtle">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-accent">
            {t("audiobook.progress.chapter", {
              current: currentChapter,
              total: totalChapters,
            })}
          </span>
          {chunkTotal > 0 && (
            <span className="text-[11px] text-neutral-500">
              · {t("audiobook.progress.chunk", {
                current: chunkCurrent,
                total: chunkTotal,
              })}
            </span>
          )}
          {totalChars > 0 && (
            <span className="text-[11px] text-neutral-500 font-mono">
              · {Math.round(charsDone).toLocaleString()}/
              {totalChars.toLocaleString()} chars
            </span>
          )}
        </div>
        <div className="text-[11px] text-neutral-500 font-mono flex items-baseline gap-3">
          {elapsedMs !== null && (
            <span>
              {t("audiobook.progress.elapsed", {
                time: formatDuration(elapsedMs),
              })}
            </span>
          )}
          {charsPerMin !== null && (
            <span>
              {t("audiobook.progress.rate", { n: charsPerMin })}
            </span>
          )}
          {etaMs !== null && (
            <span>
              {t("audiobook.progress.eta", { time: formatDuration(etaMs) })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Intro editor
// ---------------------------------------------------------------------

/** Default intro suggestion as readable plain text. Names ("Qwen3-TTS",
 *  "gemma4:26b", "PageMentor") stay in their canonical form — the
 *  backend Gemma pre-pass turns them into TTS-pronounceable phonetics
 *  ("Kwenn drei T T S", "Dschemma vier", "Peigementor") right before
 *  synthesis. That keeps the editor readable and lets the user fix
 *  spelling mistakes without having to know about the phonetic
 *  transformations the TTS engine needs. */
function buildIntroDefault(
  meta: { title: string; author: string | null; language: string } | null,
  voice: Voice | null,
  model: string
): string {
  if (!meta) return "";
  const isDe = meta.language === "de";
  const lines: string[] = [];

  // Drop UI suffixes from the voice label — they are picker hints,
  // not part of the spoken voice name. Two formats in use:
  //   "Siri (Design)"  – parenthetical, e.g. user uploads
  //   "Siri · Design"  – middle-dot, qwen.ts adds this for designs
  const spokenVoiceLabel = voice
    ? voice.label
        .replace(/\s*[·•]\s*\S.*$/, "")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .trim()
    : "";

  if (isDe) {
    lines.push(`Hörbuch: ${meta.title}.`);
    lines.push("");
    if (meta.author) {
      lines.push(`Von ${meta.author}.`);
    }
    if (model) {
      lines.push(`Aufbereitet durch ${model}.`);
    }
    if (voice) {
      lines.push(
        `Gesprochen durch Qwen3-TTS, mit der Stimme ${spokenVoiceLabel}.`
      );
    }
    lines.push(`Erstellt mit PageMentor.`);
  } else {
    lines.push(`Audiobook: ${meta.title}.`);
    lines.push("");
    if (meta.author) {
      lines.push(`By ${meta.author}.`);
    }
    if (model) {
      lines.push(`Prepared with ${model}.`);
    }
    if (voice) {
      lines.push(
        `Narrated by Qwen3-TTS, with the voice ${spokenVoiceLabel}.`
      );
    }
    lines.push(`Created with PageMentor.`);
  }
  return lines.join("\n");
}

function IntroEditor({
  intro,
  voice,
  modelName,
  busy,
  canGenerate,
  onSave,
  onGenerate,
  onDeleteAudio,
  onPreprocess,
  onEditTts,
}: {
  intro: {
    text: string | null;
    audioUrl: string | null;
    docMeta: {
      title: string;
      author: string | null;
      language: string;
    } | null;
  };
  voice: Voice | null;
  modelName: string;
  busy: boolean;
  canGenerate: boolean;
  onSave: (text: string | null) => void;
  onGenerate: () => void;
  onDeleteAudio: () => void;
  onPreprocess: (force: boolean) => void;
  onEditTts: () => void;
}) {
  const [draft, setDraft] = useState<string>("");
  const [open, setOpen] = useState<boolean>(false);

  // Sync locally on external intro updates — prevents stale draft.
  useEffect(() => {
    setDraft(intro.text ?? "");
  }, [intro.text]);

  const defaultText = useMemo(
    () => buildIntroDefault(intro.docMeta, voice, modelName),
    [intro.docMeta, voice, modelName]
  );

  const dirty = (intro.text ?? "") !== draft;
  const hasIntro = !!(intro.text && intro.text.trim().length > 0);

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            {t("audiobook.intro.title")}
            {hasIntro && (
              <span className="tag-accent text-[10px]">
                {t("audiobook.intro.active")}
              </span>
            )}
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t("audiobook.intro.hint")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-accent hover:underline"
        >
          {open ? t("audiobook.intro.collapse") : t("audiobook.intro.expand")}
        </button>
      </div>

      {open && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full bg-bg-elevated border border-border rounded-lg p-3 min-h-[140px] font-mono text-[12px] leading-relaxed text-neutral-100 resize-y focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
            placeholder={defaultText || t("audiobook.intro.placeholder")}
            spellCheck
          />
          <div className="flex items-center gap-2 flex-wrap">
            {defaultText && draft !== defaultText && (
              <Button
                variant="ghost"
                onClick={() => setDraft(defaultText)}
                disabled={busy}
              >
                {t("audiobook.intro.useDefault")}
              </Button>
            )}
            <div className="flex-1" />
            {hasIntro && !dirty && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => onPreprocess(false)}
                  disabled={busy}
                >
                  {busy
                    ? t("audiobook.intro.preprocessBusy")
                    : t("audiobook.intro.preprocess")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={onEditTts}
                  disabled={busy}
                >
                  {t("audiobook.intro.viewEdit")}
                </Button>
              </>
            )}
            {hasIntro && intro.audioUrl && (
              <Button variant="outline" onClick={onDeleteAudio} disabled={busy}>
                {t("audiobook.intro.deleteAudio")}
              </Button>
            )}
            {hasIntro && !intro.audioUrl && (
              <Button
                variant="outline"
                onClick={onGenerate}
                disabled={busy || !canGenerate}
                title={!canGenerate ? t("audiobook.voice.empty") : undefined}
              >
                {t("audiobook.intro.generateAudio")}
              </Button>
            )}
            <Button
              onClick={() => onSave(draft.trim() ? draft : null)}
              disabled={busy || !dirty}
            >
              {busy ? t("common.saving") : t("audiobook.intro.save")}
            </Button>
          </div>
          {intro.audioUrl && (
            <audio
              controls
              preload="none"
              src={intro.audioUrl}
              className="w-full accent-accent [color-scheme:dark]"
            />
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Kind filter bar
// ---------------------------------------------------------------------

const KIND_FILTERS: Array<{ kind: string; defaultOn: boolean }> = [
  { kind: "content", defaultOn: true },
  { kind: "summary", defaultOn: true },
  { kind: "example", defaultOn: false },
  { kind: "exercise", defaultOn: false },
  { kind: "self_check", defaultOn: false },
  { kind: "solutions", defaultOn: false },
  { kind: "index", defaultOn: false },
  { kind: "references", defaultOn: false },
  { kind: "meta", defaultOn: false },
];

function KindFilterBar({
  chapters,
  busy,
  onToggle,
}: {
  chapters: ChapterAudioStatus[];
  busy: string | null;
  onToggle: (kind: string, include: boolean) => void;
}) {
  // Per kind: how many chapters + how many currently included.
  const stats = useMemo(() => {
    const m = new Map<string, { total: number; included: number }>();
    for (const c of chapters) {
      const cur = m.get(c.kind) ?? { total: 0, included: 0 };
      cur.total++;
      const isIncluded =
        c.include_in_audio == null
          ? c.kind === "content" || c.kind === "summary"
          : c.include_in_audio === 1;
      if (isIncluded) cur.included++;
      m.set(c.kind, cur);
    }
    return m;
  }, [chapters]);

  // Only show filters for kinds actually present in the doc.
  const visible = KIND_FILTERS.filter((f) => stats.has(f.kind));
  if (visible.length === 0) return null;

  return (
    <section className="card p-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold">
          {t("audiobook.kindFilter.title")}
        </h3>
        <span className="text-[11px] text-neutral-500">
          {t("audiobook.kindFilter.hint")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map(({ kind }) => {
          const s = stats.get(kind)!;
          const allOn = s.included === s.total;
          const allOff = s.included === 0;
          const label = t(`chapters.kind.${kind}`);
          return (
            <div
              key={kind}
              className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-bg-elevated"
            >
              <span className="text-xs text-neutral-300">
                {label}{" "}
                <span className="text-neutral-500">
                  ({s.included}/{s.total})
                </span>
              </span>
              <button
                type="button"
                onClick={() => onToggle(kind, true)}
                disabled={busy != null || allOn}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded ml-1",
                  allOn
                    ? "bg-emerald-700/40 text-emerald-200 cursor-default"
                    : "bg-neutral-700 text-neutral-200 hover:bg-emerald-700/30"
                )}
                title={t("audiobook.kindFilter.allOn")}
              >
                {busy === kind ? "…" : t("common.yes")}
              </button>
              <button
                type="button"
                onClick={() => onToggle(kind, false)}
                disabled={busy != null || allOff}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded",
                  allOff
                    ? "bg-red-700/40 text-red-200 cursor-default"
                    : "bg-neutral-700 text-neutral-200 hover:bg-red-700/30"
                )}
                title={t("audiobook.kindFilter.allOff")}
              >
                {t("common.no")}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
