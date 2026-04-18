import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  subscribeProgress,
  type AudioDocument,
  type AudioTrack,
  type ProgressEvent,
  type Voice,
} from "../lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { cn } from "../lib/cn";
import { getSettings } from "../lib/settings";
import { PodcastShareModal } from "./PodcastShareModal";
import { t } from "../lib/i18n";

interface Props {
  docId: string;
  documentLanguage: string;
}

const RATE_OPTIONS: Array<{ value: string; key: string }> = [
  { value: "-10%", key: "rate.-10" },
  { value: "+0%", key: "rate.0" },
  { value: "+10%", key: "rate.+10" },
  { value: "+20%", key: "rate.+20" },
  { value: "+30%", key: "rate.+30" },
];

export function Audiobook({ docId, documentLanguage }: Props) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [rate, setRate] = useState(() => getSettings().defaultRate || "+0%");
  const [state, setState] = useState<AudioDocument | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [chapterProgress, setChapterProgress] = useState<Map<string, ProgressEvent>>(new Map());
  const [bookProgress, setBookProgress] = useState<{
    totalChapters: number;
    currentChapter: number;
    chunkCurrent: number;
    chunkTotal: number;
    startedAt: number;
  } | null>(null);
  const [elapsedTick, setElapsedTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const toast = useToast();

  // Initial load: voices + current audio state
  useEffect(() => {
    Promise.all([api.audio.voices(), api.audio.get(docId)])
      .then(([v, a]) => {
        setVoices(v.voices);
        setState(a);
        const settings = getSettings();
        const langVoices = v.voices.filter((vc) => vc.language === documentLanguage);
        const fromSettings =
          settings.defaultVoice && v.voices.find((vc) => vc.id === settings.defaultVoice)
            ? settings.defaultVoice
            : null;
        const preferred =
          fromSettings ??
          langVoices.find((vc) => vc.flagship)?.id ??
          langVoices[0]?.id ??
          v.voices[0]?.id ??
          "";
        setVoiceId(preferred);
      })
      .catch((err) => toast.show(err instanceof Error ? err.message : t("common.error"), "error"));
  }, [docId, documentLanguage, toast]);

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
        setBookProgress({
          totalChapters: ev.total ?? 0,
          currentChapter: 0,
          chunkCurrent: 0,
          chunkTotal: 0,
          startedAt: Date.now(),
        });
      } else if (ev.phase === "audiobook.chapter.start") {
        setBookProgress((prev) => ({
          totalChapters: ev.total ?? prev?.totalChapters ?? 0,
          currentChapter: ev.current ?? prev?.currentChapter ?? 0,
          chunkCurrent: 0,
          chunkTotal: 0,
          startedAt: prev?.startedAt ?? Date.now(),
        }));
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
      if (
        ev.phase === "audiobook.done" ||
        ev.phase === "audiobook.failed" ||
        ev.phase === "audiobook.canceled" ||
        ev.phase === "audiobook.chapter.done" ||
        ev.phase === "audiobook.book.building"
      ) {
        // Refresh audio list
        api.audio.get(docId).then(setState).catch(() => {});
      }
    });
    return unsubscribe;
  }, [docId]);

  async function generate() {
    if (!voiceId) return;
    setBusy(true);
    try {
      await api.audio.generate(docId, voiceId, rate);
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

  async function clearChapter(audioId: string) {
    if (!confirm(t("audiobook.clearChapterConfirm"))) return;
    try {
      await api.audio.clearChapter(audioId);
      const refreshed = await api.audio.get(docId);
      setState(refreshed);
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

  const langVoices = useMemo(
    () => voices.filter((v) => v.language === documentLanguage),
    [voices, documentLanguage]
  );
  const otherVoices = useMemo(
    () => voices.filter((v) => v.language !== documentLanguage),
    [voices, documentLanguage]
  );

  // Terminal-Phasen dürfen `generating` NICHT mehr true halten — sonst
  // bleibt der Generate-Button nach einem Fehlschlag disabled.
  const progressIsTerminal =
    progress?.phase === "audiobook.done" ||
    progress?.phase === "audiobook.failed" ||
    progress?.phase === "audiobook.canceled";
  const progressIsInFlight =
    progress?.phase.startsWith("audiobook.") === true && !progressIsTerminal;
  const generating = (state?.generating ?? false) || progressIsInFlight;
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
          <div className="flex gap-2 flex-wrap">
            {state?.book && (
              <a href={state.book.url} className="btn-outline" download>
                {t("audiobook.download.m4b")}
              </a>
            )}
            {(state?.audio.some((a) => a.status === "done") ?? false) && (
              <Button variant="outline" onClick={() => setShareOpen(true)}>
                {t("audiobook.apple")}
              </Button>
            )}
            {(state?.audio.length ?? 0) > 0 && (
              <Button variant="danger" onClick={clearAll}>
                {t("audiobook.clear")}
              </Button>
            )}
          </div>
        </div>

        {bookProgress && <BookProgressPanel progress={bookProgress} />}

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
                    {t(r.key)}
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
          <Button onClick={generate} disabled={busy || generating || !voiceId}>
            {generating
              ? t("audiobook.generating")
              : state?.audio.length
              ? t("audiobook.regenerate")
              : t("audiobook.generate")}
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

      <ChapterList
        audio={state?.audio ?? []}
        chapterProgress={chapterProgress}
        generating={generating}
        onClearChapter={clearChapter}
      />

      <PodcastShareModal
        open={shareOpen}
        docId={docId}
        onClose={() => setShareOpen(false)}
      />
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
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-neutral-100">{voice.label}</span>
        {voice.flagship && (
          <span className="tag-accent text-[10px]">{t("audiobook.voice.top")}</span>
        )}
      </div>
      <span className="text-[11px] text-neutral-500">
        {voice.gender === "female" ? "♀" : "♂"} · {voice.locale}
      </span>
    </button>
  );
}

function ChapterList({
  audio,
  chapterProgress,
  generating,
  onClearChapter,
}: {
  audio: AudioTrack[];
  chapterProgress: Map<string, ProgressEvent>;
  generating: boolean;
  onClearChapter: (audioId: string) => void;
}) {
  if (audio.length === 0 && !generating) {
    return (
      <div className="card p-8 text-center text-sm text-neutral-500">
        {t("audiobook.empty")}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {audio.map((track) => (
        <ChapterAudio
          key={track.id}
          track={track}
          progress={chapterProgress.get(track.chapter_id) ?? null}
          onClear={() => onClearChapter(track.id)}
        />
      ))}
    </ul>
  );
}

function ChapterAudio({
  track,
  progress,
  onClear,
}: {
  track: AudioTrack;
  progress: ProgressEvent | null;
  onClear: () => void;
}) {
  const phase = progress?.phase;
  const isRunning =
    phase === "audiobook.chapter.start" || phase === "audiobook.chapter.progress";
  const failed = track.status === "failed" || phase === "audiobook.chapter.failed";

  return (
    <li className="card p-4 flex flex-col gap-2">
      <div className="flex items-start gap-4">
        <div className="font-mono text-sm text-accent min-w-[2ch] text-right pt-1">
          {String(track.chapter_number).padStart(2, "0")}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-neutral-100 truncate">
            {track.chapter_title || `Kapitel ${track.chapter_number}`}
          </h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            {track.status === "done" && track.duration_ms > 0
              ? formatDuration(track.duration_ms)
              : isRunning
              ? t("audiobook.chapterPartsRunning", {
                  current: progress?.current ?? 1,
                  total: progress?.total ?? "?",
                })
              : failed
              ? t("audiobook.chapterFailed")
              : t("audiobook.chapterPartsWaiting")}
            {" · "}
            {track.voice || t("common.none")}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {track.status === "done" && (
            <a
              href={api.audio.fileUrl(track.id)}
              download
              className="text-xs text-neutral-400 hover:text-accent"
            >
              {t("audiobook.downloadMp3")}
            </a>
          )}
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-neutral-500 hover:text-accent"
            title={t("audiobook.clearChapter")}
            aria-label={t("audiobook.clearChapter")}
          >
            ✕
          </button>
        </div>
      </div>

      {track.status === "done" && (
        <audio
          controls
          preload="none"
          src={api.audio.fileUrl(track.id)}
          className="w-full accent-accent [color-scheme:dark]"
        />
      )}
      {isRunning && progress?.current && progress?.total && (
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
}: {
  progress: {
    totalChapters: number;
    currentChapter: number;
    chunkCurrent: number;
    chunkTotal: number;
    startedAt: number;
  };
}) {
  const { totalChapters, currentChapter, chunkCurrent, chunkTotal, startedAt } = progress;
  const chapterShare = chunkTotal > 0 ? chunkCurrent / chunkTotal : 0;
  const done = Math.max(0, currentChapter - 1) + chapterShare;
  const frac = totalChapters > 0 ? Math.min(1, done / totalChapters) : 0;
  const pct = Math.round(frac * 100);

  const elapsedMs = Date.now() - startedAt;
  // ETA nur sinnvoll sobald es echten Fortschritt gibt, sonst extrapolieren
  // wir ins Uferlose.
  const eta =
    frac > 0.02 ? Math.max(0, Math.round((elapsedMs * (1 - frac)) / frac)) : null;

  return (
    <div className="card p-4 bg-bg-elevated flex flex-col gap-2 border-accent-subtle">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-accent font-mono">{pct}%</span>
          <span className="text-xs text-neutral-400">
            {t("audiobook.progress.chapter", {
              current: currentChapter,
              total: totalChapters,
            })}
          </span>
        </div>
        <div className="text-[11px] text-neutral-500 font-mono text-right">
          <div>
            {t("audiobook.progress.elapsed", { time: formatDuration(elapsedMs) })}
          </div>
          {eta !== null && (
            <div>
              {t("audiobook.progress.eta", { time: formatDuration(eta) })}
            </div>
          )}
        </div>
      </div>
      <div className="h-2 bg-black/40 rounded overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {chunkTotal > 0 && (
        <div className="text-[11px] text-neutral-500">
          {t("audiobook.progress.chunk", {
            current: chunkCurrent,
            total: chunkTotal,
          })}
        </div>
      )}
    </div>
  );
}
