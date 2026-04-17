import { Button } from "./ui/Button";
import { api, type Document, type ProgressEvent } from "../lib/api";
import { t } from "../lib/i18n";
import { cn } from "../lib/cn";
import { useToast } from "./ui/Toast";

interface Props {
  doc: Document;
  liveEvent?: ProgressEvent;
  onOpen: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

const statusColor: Record<Document["ocr_status"], string> = {
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

function PipelineDots({ doc }: { doc: Document }) {
  const steps = [
    {
      key: "ocr",
      label: t("pipe.text"),
      state:
        doc.ocr_status === "done"
          ? "done"
          : doc.ocr_status === "running"
          ? "running"
          : doc.ocr_status === "failed"
          ? "failed"
          : "pending",
      count: doc.page_count || 0,
    },
    {
      key: "chapters",
      label: t("pipe.chapters"),
      state: (doc.chapter_count ?? 0) > 0 ? "done" : "pending",
      count: doc.chapter_count ?? 0,
    },
    {
      key: "audio",
      label: t("pipe.audio"),
      state:
        (doc.audio_total ?? 0) === 0
          ? "pending"
          : (doc.audio_done ?? 0) === (doc.audio_total ?? 0)
          ? "done"
          : "running",
      count: doc.audio_total ? `${doc.audio_done}/${doc.audio_total}` : "0",
    },
    {
      key: "cards",
      label: t("pipe.cards"),
      state: (doc.card_count ?? 0) > 0 ? "done" : "pending",
      count: doc.card_count ?? 0,
    },
    {
      key: "summary",
      label: t("pipe.summary"),
      state: (doc.summary_count ?? 0) > 0 ? "done" : "pending",
      count: doc.summary_count ?? 0,
    },
  ];

  return (
    <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          {i > 0 && <span className="text-neutral-700">›</span>}
          <span
            className={
              "inline-block w-1.5 h-1.5 rounded-full " +
              (s.state === "done"
                ? "bg-emerald-500"
                : s.state === "running"
                ? "bg-amber-400 animate-pulse"
                : s.state === "failed"
                ? "bg-accent"
                : "bg-neutral-700")
            }
          />
          <span>{s.label}</span>
          {s.state !== "pending" && <span className="text-neutral-600">{s.count}</span>}
        </div>
      ))}
    </div>
  );
}

export function DocumentCard({ doc, liveEvent, onOpen, onDelete, onEdit }: Props) {
  const toast = useToast();

  async function retry() {
    try {
      await api.documents.reprocess(doc.id);
      toast.show(t("library.retryStarted"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  return (
    <div
      className="card card-hover p-4 flex flex-col gap-3 cursor-pointer group"
      onDoubleClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="tag-accent uppercase">{t(`type.${doc.type}`)}</span>
            <span
              className={cn(
                "tag",
                statusColor[doc.ocr_status] ?? statusColor.pending
              )}
            >
              {t(`ocr.${doc.ocr_status}`)}
            </span>
          </div>
          <h3
            className="font-semibold text-neutral-100 line-clamp-2 leading-snug"
            title={doc.title}
          >
            {doc.title}
          </h3>
          <p className="text-xs text-neutral-500 mt-1 truncate">
            {doc.page_count > 0 ? `${doc.page_count} ${t("library.pagesShort")} · ` : ""}
            {(doc.size_bytes / 1024 / 1024).toFixed(1)} MB
          </p>
        </div>
        <div className="text-4xl opacity-40 group-hover:opacity-70 transition-opacity">
          📄
        </div>
      </div>

      {doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {doc.tags.slice(0, 5).map((tg) => (
            <span key={tg} className="tag">
              #{tg}
            </span>
          ))}
        </div>
      )}

      <PipelineDots doc={doc} />

      {liveEvent && (
        <div className="text-[11px] text-amber-400/80 truncate flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          {describeLive(liveEvent)}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto pt-2 border-t border-border">
        <Button variant="ghost" onClick={onOpen} className="!px-2 !py-1 text-xs">
          {t("library.openDoc")} →
        </Button>
        <div className="flex items-center gap-1">
          {doc.ocr_status === "failed" && (
            <Button
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                retry();
              }}
              className="!px-2 !py-1 text-xs"
              title={t("library.retry")}
            >
              ↻ {t("library.retry")}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={onEdit}
            className="!px-2 !py-1 text-xs"
            title={t("common.edit")}
            aria-label={t("common.edit")}
          >
            ✎
          </Button>
          <Button variant="danger" onClick={onDelete} className="!px-2 !py-1 text-xs">
            {t("library.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
}
