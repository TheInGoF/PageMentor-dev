// Eine Kapitelzeile: Status, Aufbereitung, Erzeugen, Anhören
import { api, type ChapterAudioStatus, type ProgressEvent } from "../../lib/api";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { formatDuration } from "./helpers";

export function ChapterRow({
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
