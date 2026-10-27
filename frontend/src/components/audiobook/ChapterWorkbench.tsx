// Kapitelliste mit Auswahl und Sammelaktionen
import { useState } from "react";
import type { ChapterAudioStatus, ProgressEvent } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { ChapterRow } from "./ChapterRow";
import { isChapterIncluded } from "./helpers";

export function ChapterWorkbench({
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
