// Eine Karte in der Liste, Statistik-Pille
import { useState } from "react";
import {
  type Card,
} from "../../lib/api";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";
import { renderMarkdown } from "../../lib/markdown";

export function StatPill({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={cn(
        "card p-3 text-center",
        accent && value > 0 ? "border-accent-subtle bg-accent/5" : ""
      )}
    >
      <div className={cn("text-2xl font-semibold", accent && value > 0 ? "text-accent" : "")}>
        {value}
      </div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
    </div>
  );
}

function sourceLabel(source: Card["source"]): string {
  if (source === "ai_generated") return t("cards.source.ai");
  return t("cards.source.manual");
}

export function CardRow({
  card,
  onDelete,
  onEdit,
}: {
  card: Card;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card card-hover p-4">
      <div className="flex items-start gap-3">
        <button
          onClick={() => setOpen(!open)}
          className="text-xs text-accent w-5 flex-shrink-0 mt-1"
          aria-label="toggle"
        >
          {open ? "▾" : "▸"}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-neutral-100 line-clamp-2">
            {renderMarkdown(card.question)}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-neutral-500 mt-1">
            {card.chapter_number && (
              <span>
                {t("library.chaptersShort")} {String(card.chapter_number).padStart(2, "0")}
              </span>
            )}
            <span>·</span>
            <span>{sourceLabel(card.source)}</span>
            {card.hint && (
              <>
                <span>·</span>
                <span className="text-amber-400">{t("cards.hintChip")}</span>
              </>
            )}
            {typeof card.reps === "number" && card.reps > 0 && (
              <>
                <span>·</span>
                <span>{t("cards.reviewed", { n: card.reps })}</span>
              </>
            )}
          </div>
          {open && (
            <div className="mt-3 pt-3 border-t border-border text-sm text-neutral-300 space-y-2">
              {card.hint && (
                <div className="text-amber-400/90 text-xs italic">
                  💡 {renderMarkdown(card.hint)}
                </div>
              )}
              {card.answer ? (
                <div>{renderMarkdown(card.answer)}</div>
              ) : (
                <span className="text-neutral-500 italic">{t("cards.noAnswer")}</span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onEdit}
          className="text-xs text-neutral-500 hover:text-accent"
          aria-label={t("common.edit")}
          title={t("common.edit")}
        >
          ✎
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-neutral-500 hover:text-accent"
          aria-label={t("common.delete")}
          title={t("common.delete")}
        >
          ✕
        </button>
      </div>
    </li>
  );
}
