// Bibliothek: ein Dokument als kompakte Zeile; Kapitel, Karten und Hörbuch stehen in den Details
import { AssignHint } from "./AssignHint";
import { Button } from "../ui/Button";
import { api, type Document, type ProgressEvent } from "../../lib/api";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { useToast } from "../ui/Toast";

interface Props {
  doc: Document;
  liveEvent?: ProgressEvent;
  onOpen: () => void;
  onDelete: () => void;
  onEdit: () => void;
  /** Called after a retry/reprocess was accepted by the backend so
   *  the list refreshes — a "failed" card otherwise never re-polls. */
  onRetried?: () => void;
}

const statusColor: Record<Document["ocr_status"], string> = {
  "awaiting-extraction": "text-neutral-400 border-border",
  pending: "text-neutral-500 border-border",
  running: "text-amber-400 border-amber-500/40",
  done: "text-emerald-400 border-emerald-500/40",
  failed: "text-accent border-accent-subtle",
};

function describeLive(ev: ProgressEvent): string {
  switch (ev.phase) {
    case "pipeline.start":
      return t("phase.pipeline.start");
    case "pipeline.extract":
      return t("phase.pipeline.extract");
    case "pipeline.chapters":
      return ev.message ?? t("phase.pipeline.chapters");
    case "pipeline.done":
      return t("phase.pipeline.done");
    case "pipeline.failed":
      return t("phase.pipeline.failed", { msg: ev.message ?? "" });
    case "audiobook.start":
      return t("phase.audiobook.start", { total: ev.total ?? 0 });
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
    case "audiobook.book.building":
      return t("phase.audiobook.book.building");
    case "audiobook.done":
      return t("phase.audiobook.done");
    default:
      return ev.message ?? ev.phase;
  }
}

export function DocumentRow({ doc, liveEvent, onOpen, onDelete, onEdit, onRetried }: Props) {
  const toast = useToast();

  async function retry(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.documents.reprocess(doc.id);
      toast.show(t("library.retryStarted"), "success");
      onRetried?.();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <li className="flex flex-col gap-2 py-2 px-2 rounded-md hover:bg-bg-hover cursor-pointer" onClick={onOpen}>
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate" title={doc.title}>
            {doc.series_sequence?.trim() && <span className="mr-2 text-accent font-semibold tabular-nums">{doc.series_sequence.trim()}</span>}
            {doc.title}
          </div>
          <div className="text-xs text-neutral-500 truncate">
            {[t(`type.${doc.type}`), doc.short_code, doc.page_count > 0 ? `${doc.page_count} ${t("library.pagesShort")}` : null, ...doc.tags.slice(0, 3).map((tg) => `#${tg}`)]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {liveEvent ? (
          <span className="text-xs text-amber-500 truncate max-w-[16rem] flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            {describeLive(liveEvent)}
          </span>
        ) : (
          doc.ocr_status !== "done" && <span className={cn("tag shrink-0", statusColor[doc.ocr_status] ?? statusColor.pending)}>{t(`ocr.${doc.ocr_status}`)}</span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {doc.ocr_status === "failed" && (
            <Button variant="outline" onClick={retry} className="!px-2 !py-1 text-xs" title={t("library.retry")}>
              ↻ {t("library.retry")}
            </Button>
          )}
          <Button variant="ghost" onClick={stop(onEdit)} className="!px-2 !py-1 text-xs" title={t("common.edit")} aria-label={t("common.edit")}>
            ✎
          </Button>
          <Button variant="ghost" onClick={stop(onDelete)} className="!px-2 !py-1 text-xs" title={t("library.delete")} aria-label={t("library.delete")}>
            🗑
          </Button>
        </div>
      </div>
      <AssignHint doc={doc} onChanged={onRetried} />
    </li>
  );
}
