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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [m4bBusy, setM4bBusy] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  // Snapshot für den SSE-Handler, der sonst stale chapterStatus sieht
  // (useEffect-Deps halten es nicht frisch). Beim `audiobook.start`-
  // Event wird chapterCharsRef.current gelesen.
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
      // Silent — wenn der Endpoint mal kurz nicht geht (Pipeline-Reload),
      // nicht mit Toast spammen.
    }
  }, [docId]);

  // Initial load: voices + current audio state + per-chapter status
  useEffect(() => {
    loadChapterStatus();
  }, [loadChapterStatus]);
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
          // User-Wahl nicht überschreiben — nur initial setzen (wenn leer)
          // oder wenn die bisherige Wahl gar nicht mehr in der Liste ist
          // (Voice wurde gelöscht). Verhindert, dass der Picker bei
          // Re-Rendern (Toast-Show, State-Update) auf Default zurückspringt.
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
    // Voice-Liste neu laden wenn in Settings eine Stimme angelegt/
    // gelöscht wurde. SettingsModal feuert `pm:voices-changed`; ohne
    // diesen Listener zeigt der Audiobook-Picker nur die Voices die
    // beim Tab-Öffnen existierten.
    const voicesChangedHandler = () => {
      api.audio.voices().then((v) => setVoices(v.voices)).catch(() => {});
    };
    window.addEventListener("pm:voices-changed", voicesChangedHandler);
    return () => {
      window.removeEventListener("pm:voices-changed", voicesChangedHandler);
    };
    // `toast` bewusst nicht in Deps — die Fehlermeldung ist nur ein Side-Effect,
    // braucht den Effect nicht zu triggern. Voice-Load hängt an Doc + Sprache.
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
      // Book-level Progress aus den phase-Events ableiten.
      if (ev.phase === "audiobook.start") {
        // Zeichen-Snapshot der zum Run eingeschlossenen Kapitel —
        // bildet die Grundlage für die ETA (ms/Zeichen × remaining).
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
        // Nur fortschreiben wenn ein Full-Book-Run schon gestartet
        // ist (audiobook.start hat bookProgress != null gesetzt).
        // Single-Chapter- und Intro-Generates emittieren chapter.*-
        // Events ohne audiobook.start — die sollen das Full-Book-
        // Progress-Panel NICHT aktivieren, sonst hängt es ewig
        // weil kein audiobook.done je kommt.
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
        setBookProgress((prev) =>
          prev
            ? {
                ...prev,
                chunkCurrent: ev.current ?? 0,
                chunkTotal: ev.total ?? 0,
              }
            : prev
        );
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
      }
      // M4B-Encode-Progress-Events (SSE vom Backend beim Book-Build
      // oder Rebuild). current = aktuelle Audio-Position in ms,
      // total = gemergte MP3-Dauer in ms. Damit der User sieht wie
      // weit ffmpeg wirklich ist statt nur "builds …" zu lesen.
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

  async function rebuildM4B() {
    setM4bBusy(true);
    try {
      await api.audio.rebuildM4B(docId);
      const refreshed = await api.audio.get(docId);
      setState(refreshed);
      toast.show(t("audiobook.m4b.built"), "success");
    } catch (err) {
      // Leere Error-Messages (z. B. wenn Backend nur Status 4xx ohne
      // Body liefert oder Fetch abbricht) → Fallback auf Übersetzung,
      // sonst sieht der User einen roten Toast ohne Text.
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
      // Reihenfolge matters: Audio-Liste UND per-Kapitel-Status aus
      // dem Backend neu ziehen, sonst bleibt die Row im UI als "fertig"
      // stehen weil chapterStatus noch die alte audio_id hält.
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
      setBookProgress(null);
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
      // Background-Job läuft, Status wird via SSE aktualisiert.
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

  async function bulkIncludeByKind(kind: string, include: boolean) {
    setKindBulkBusy(kind);
    // Optimistic — UI updaten bevor Backend antwortet.
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

  /** Sequentielles Preprocess für alle ausgewählten. Sequentiell statt
   *  parallel weil Ollama auf einem Modell eh nur einen Generate-Call
   *  zur Zeit verarbeitet — paralleler Aufruf würde nur die HTTP-Queue
   *  füllen und die App ggf. mit Timeouts überraschen. */
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
        // Kurze Pause damit das UI atmen kann + status-load nicht
        // direkt mit dem nächsten Generate-Call kollidiert.
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

  // Counts für den Haupt-Button-Label. Das Backend überspringt bereits
  // fertige Kapitel beim Hörbuch-Run (v1.18.010); das UI soll das auch
  // ehrlich widerspiegeln statt "Neu erzeugen" zu sagen während in
  // Wahrheit nur die fehlenden generiert werden.
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

  // Terminal-Phasen dürfen `generating` NICHT mehr true halten — sonst
  // bleibt der Generate-Button nach einem Fehlschlag disabled.
  const progressIsTerminal =
    progress?.phase === "audiobook.done" ||
    progress?.phase === "audiobook.failed" ||
    progress?.phase === "audiobook.canceled";
  // „in flight" nur wenn ein Full-Book-Run aktiv ist (bookProgress
  // gesetzt). Bei Single-Chapter- oder Intro-Generates emittiert das
  // Backend ja chapter.start/done, aber das ist KEIN Full-Book-Run —
  // sonst bliebe der Generate-Button disabled bis zum nächsten
  // Doc-Wechsel. Per-chapter „busy"-State zeigt das schon im Row.
  const progressIsInFlight =
    !!bookProgress &&
    progress?.phase.startsWith("audiobook.") === true &&
    !progressIsTerminal;
  // Auch Single-Chapter- und Intro-Generates zählen als „läuft was" —
  // sonst sieht der User keinen Cancel-Button wenn er ein einzelnes
  // Kapitel generiert hat und das jetzt hängen bleibt. Wir leiten
  // „aktives Kapitel" aus den SSE-chapter.*-Events ab: solange ein
  // Kapitel in start/progress-Phase steckt (also nicht done/failed/
  // canceled), läuft da was im Backend.
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

  // Tick 1× pro Sekunde, damit Laufzeit + Restzeit sichtbar weiterzählen
  // (Book-Progress-State selbst ändert sich nur bei SSE-Events).
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
  /** Vom Backend gemessener EMA-Durchschnitt für die gewählte Voice.
   *  Wird als Startwert für die ETA genutzt, bevor der laufende Run
   *  genug eigene Messpunkte hat. `null` → erste Generation dieser
   *  Voice, wir zeigen keine ETA bis genug Daten da sind. */
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
  const elapsedMs = Date.now() - startedAt;

  // Gesamt-Zeichen + bis hierhin gemachte Zeichen.
  const totalChars = chapterChars.reduce((a, b) => a + b, 0);

  // Fertige Kapitel bis currentChapter-1 (exkl.) zählen voll mit.
  const completedIdx = Math.max(0, currentChapter - 1);
  const completedChars = chapterChars
    .slice(0, completedIdx)
    .reduce((a, b) => a + b, 0);

  // Aktuelles Kapitel proportional über chunks zählen.
  const currentChapterTotal =
    currentChapter >= 1 && currentChapter <= chapterChars.length
      ? chapterChars[currentChapter - 1]
      : 0;
  const chapterFrac = chunkTotal > 0 ? chunkCurrent / chunkTotal : 0;
  const charsDone = completedChars + currentChapterTotal * chapterFrac;
  const charsRemaining = Math.max(0, totalChars - charsDone);

  // Rate-Wahl: live wenn wir genug eigene Daten haben, sonst Backend-
  // Benchmark. Schwelle 800 Zeichen = meistens >= 1 Chunk durch →
  // genug um die live-Messung über Rauschen zu heben.
  const liveRate = charsDone >= 800 ? elapsedMs / charsDone : null;
  const rate = liveRate ?? benchmarkMsPerChar;

  const etaMs =
    rate !== null ? Math.max(0, Math.round(charsRemaining * rate)) : null;

  // Anzeige der Rate in Zeichen/Sekunde, damit Gefühl dafür entsteht.
  const charsPerSec =
    rate !== null && rate > 0 ? Math.round(1000 / rate) : null;

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
          <span>
            {t("audiobook.progress.elapsed", { time: formatDuration(elapsedMs) })}
          </span>
          {charsPerSec !== null && (
            <span>
              {t("audiobook.progress.rate", { n: charsPerSec })}
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
// Intro-Editor
// ---------------------------------------------------------------------

/** Default-Intro-Vorschlag. Jede Zeile endet mit Satzzeichen (. oder
 *  Komma), sonst rattert Edge alles ohne Pausen runter — Newlines
 *  alleine reichen der TTS-Engine nicht für Atempausen. */
function buildIntroDefault(
  meta: { title: string; author: string | null; language: string } | null,
  voice: Voice | null,
  model: string
): string {
  if (!meta) return "";
  const isDe = meta.language === "de";
  const lines: string[] = [];

  if (isDe) {
    lines.push(`Hörbuch: ${meta.title}.`);
    lines.push("");
    if (meta.author) {
      lines.push(`Von ${meta.author}.`);
    }
    if (model) {
      lines.push(`Aufbereitet durch ${phoneticizeModelName(model, "de")}.`);
    }
    if (voice) {
      // "Qwen" ausgeschrieben mit Doppel-N, damit Qwen-TTS nicht "Kwen"
      // sagt. Model-Version als phonetische Zahl.
      lines.push(
        `Gesprochen durch Qwenn drei T T S, mit der Stimme ${voice.label}.`
      );
    }
  } else {
    lines.push(`Audiobook: ${meta.title}.`);
    lines.push("");
    if (meta.author) {
      lines.push(`By ${meta.author}.`);
    }
    if (model) {
      lines.push(`Prepared with ${phoneticizeModelName(model, "en")}.`);
    }
    if (voice) {
      lines.push(
        `Narrated by Qwenn three T T S, with the voice ${voice.label}.`
      );
    }
  }
  return lines.join("\n");
}

/** Modellnamen wie `gemma4:26b` in lesbare Intro-Phonetik umbauen:
 *  `gemma4:26b` → "Gemma Vier", `llama3.1:8b` → "Lama drei Punkt eins".
 *  Die TTS-Engine würde sonst „gemma-vier-doppelpunkt-sechsundzwanzig-b"
 *  sagen, was unschön klingt. */
function phoneticizeModelName(model: string, lang: "de" | "en"): string {
  // Alles nach Doppelpunkt (":26b", ":8b") ist Parameter-Größe — für
  // Menschen unnötig, für Betonung nervig. Abschneiden.
  let stem = model.split(":")[0] ?? model;
  // Provider-Präfix wie "jina/jina-embeddings-v2-base-de" abschneiden.
  stem = stem.includes("/") ? stem.split("/").pop()! : stem;

  const digitsDe = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun"];
  const digitsEn = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const digits = lang === "de" ? digitsDe : digitsEn;

  // Ziffern zu Wörtern, Bindestriche/Unterstriche als Leerzeichen.
  let s = stem.replace(/[_-]/g, " ");
  // Zahlen 0-9 als Wort, mehrstellig Ziffer-für-Ziffer.
  s = s.replace(/(\d+)/g, (m) =>
    m
      .split("")
      .map((d) => digits[Number(d)] ?? d)
      .join(" ")
  );
  // Punkt → "Punkt"/"point" ausgeschrieben, damit TTS nicht abrupt
  // satz-bricht. Nur wenn zwischen Buchstaben/Wörtern.
  s = s.replace(/(\w) *\. *(\w)/g, (_, a, b) =>
    lang === "de" ? `${a} Punkt ${b}` : `${a} point ${b}`
  );
  // Erster Buchstabe groß ("gemma" → "Gemma"), Rest lowercase mit
  // Preserved-Spaces. Wortgrenzen wie gehabt.
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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
}) {
  const [draft, setDraft] = useState<string>("");
  const [open, setOpen] = useState<boolean>(false);

  // Bei Intro-Update von außen lokal sync — verhindert Stale-Draft.
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
// Kind-Filter-Bar
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
  // Pro kind: wie viele Kapitel + wie viele aktuell included.
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

  // Nur Filter zeigen für kinds die im Doc tatsächlich vorkommen.
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
