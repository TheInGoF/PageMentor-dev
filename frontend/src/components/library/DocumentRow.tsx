// Bibliothek: ein Dokument als kompakte Zeile; Kapitel, Karten und Hörbuch stehen in den Details
import { AssignHint } from "./AssignHint";
import { Menu, type MenuItem } from "../ui/Menu";
import { type Document, type ProgressEvent } from "../../lib/api";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";

interface Props {
  doc: Document;
  liveEvent?: ProgressEvent;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  // Aktionen dieser Zeile, gleiche Liste wie im gemeinsamen Menü der Auswahl
  actions: MenuItem[];
  onChanged?: () => void;
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

export function DocumentRow({ doc, liveEvent, selected, onSelect, onOpen, actions, onChanged }: Props) {
  return (
    <li className={cn("flex flex-col gap-2 py-2 pr-2 rounded-md hover:bg-bg-hover cursor-pointer", selected && "bg-accent/5")} onClick={onOpen}>
      <div className="flex items-center gap-2 min-w-0">
        {/* Die ganze Kästchen-Spalte der Zeile ist Klickfläche (docs/STYLEGUIDE.md) */}
        <label className="self-stretch -my-2 px-4 flex items-center cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" className="w-5 h-5 cursor-pointer" checked={selected} onChange={onSelect} aria-label={t("library.select", { title: doc.title })} />
        </label>
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
        <Menu items={actions} label={t("library.actions")} />
      </div>
      <AssignHint doc={doc} onChanged={onChanged} />
    </li>
  );
}
