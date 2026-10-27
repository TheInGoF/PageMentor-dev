// Bibliothek: Modul-Chip, Modul-Kopf, leerer Zustand
import {
  type ModuleListItem,
} from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";

export function ModuleChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? "chip chip-active" : "chip"}
      style={active && color ? { borderColor: color, color } : undefined}
    >
      {label}
    </button>
  );
}

/** Section heading per module in the library. For real modules the
 *  title is a quick link to the module detail page; the unassigned
 *  section renders a static heading. Completed sections additionally
 *  get a collapse chevron (whole-row click toggles) and every module
 *  section gets a small completed-toggle on the right. */
export function ModuleSectionHeader({
  module: m,
  count,
  onOpenModule,
  onToggleCompleted,
  collapsed,
  onToggleCollapse,
}: {
  module: ModuleListItem | null;
  count: number;
  onOpenModule?: (id: string) => void;
  onToggleCompleted?: () => void;
  /** undefined = not collapsible (active sections). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  if (!m) {
    return (
      <div className="flex items-baseline gap-2 border-b border-border pb-1.5">
        <span className="text-base">📂</span>
        <h2 className="text-sm font-semibold text-neutral-300">
          {t("library.section.unassigned")}
        </h2>
        <span className="text-xs text-neutral-500">({count})</span>
      </div>
    );
  }
  const clickable = !!onOpenModule;
  const collapsible = collapsed !== undefined && !!onToggleCollapse;
  const isCompleted = !!m.completed;
  return (
    <div
      className={
        "flex items-center gap-2 border-b pb-1.5 group " +
        (isCompleted ? "opacity-70 hover:opacity-100 transition-opacity" : "")
      }
      style={{ borderBottomColor: m.color }}
    >
      {collapsible && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          title={collapsed ? t("library.section.expand") : t("library.section.collapse")}
          className="text-xs text-neutral-500 hover:text-neutral-200 w-4 shrink-0 transition-colors"
        >
          {collapsed ? "▸" : "▾"}
        </button>
      )}
      <button
        type="button"
        onClick={
          collapsible
            ? onToggleCollapse
            : clickable
            ? () => onOpenModule!(m.id)
            : undefined
        }
        disabled={!clickable && !collapsible}
        className={
          "flex items-baseline gap-2 text-left min-w-0 flex-1 " +
          (clickable || collapsible ? "cursor-pointer" : "cursor-default")
        }
        title={
          collapsible
            ? collapsed
              ? t("library.section.expand")
              : t("library.section.collapse")
            : clickable
            ? t("library.section.openModule")
            : undefined
        }
      >
        <span className="text-base">{m.icon}</span>
        <h2
          className="text-sm font-semibold transition-colors truncate"
          style={{ color: m.color }}
        >
          {m.name}
        </h2>
        {m.semester && (
          <span className="text-xs text-neutral-500 shrink-0">· {m.semester}</span>
        )}
        <span className="text-xs text-neutral-500 shrink-0">({count})</span>
      </button>
      {clickable && (
        <button
          type="button"
          onClick={() => onOpenModule!(m.id)}
          className="text-xs text-neutral-500 hover:text-neutral-200 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        >
          {t("library.section.openModule")} →
        </button>
      )}
      {onToggleCompleted && (
        <button
          type="button"
          onClick={onToggleCompleted}
          title={
            isCompleted
              ? t("library.module.markActive")
              : t("library.module.markCompleted")
          }
          className={
            "text-xs px-2 py-0.5 rounded-full border transition-colors shrink-0 " +
            (isCompleted
              ? "border-border text-neutral-400 hover:border-border-strong hover:text-neutral-200"
              : "border-border text-neutral-500 opacity-0 group-hover:opacity-100 hover:border-emerald-600 hover:text-emerald-400")
          }
        >
          {isCompleted ? `↺ ${t("library.module.markActive")}` : "✓"}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ onUpload, hasAny }: { onUpload: () => void; hasAny: boolean }) {
  return (
    <div className="card p-12 flex flex-col items-center text-center gap-4">
      <div className="text-5xl opacity-60">📚</div>
      <div>
        <h2 className="text-lg font-semibold mb-1">
          {hasAny ? t("library.empty.nomatches.title") : t("library.empty.title")}
        </h2>
        <p className="text-sm text-neutral-500">
          {hasAny ? t("library.empty.nomatches.hint") : t("library.empty.hint")}
        </p>
      </div>
      {!hasAny && <Button onClick={onUpload}>+ {t("library.upload")}</Button>}
    </div>
  );
}
