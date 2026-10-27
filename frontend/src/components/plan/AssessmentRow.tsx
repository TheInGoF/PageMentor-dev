// Eine Leistung im Plan: Art, Titel, Modul, Termin (TBA), Versuch, Status, Note, Aktionen
import type { Assessment, AssessmentStatus, ExamSlot, ModuleListItem } from "../../lib/api";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";

export const STATUSES: AssessmentStatus[] = ["geplant", "in_arbeit", "angemeldet", "bestanden", "nicht_bestanden", "abgemeldet"];

const STATUS_TONE: Record<AssessmentStatus, string> = {
  geplant: "text-neutral-400",
  in_arbeit: "text-sky-600",
  angemeldet: "text-accent",
  bestanden: "text-green-600",
  nicht_bestanden: "text-red-600",
  abgemeldet: "text-neutral-500",
};

export function formatDate(d: string | null): string {
  if (!d) return t("plan.noDate");
  const [y, m, day] = d.split("-");
  return day ? `${day}.${m}.${y}` : `${m}/${y}`;
}

export function AssessmentRow({
  a,
  module,
  slot,
  onStatus,
  onGrade,
  onShift,
  onEdit,
  onOpenModule,
}: {
  a: Assessment;
  module?: ModuleListItem;
  slot?: ExamSlot;
  onStatus: (s: AssessmentStatus) => void;
  onGrade: (g: number | null) => void;
  onShift: () => void;
  onEdit: () => void;
  onOpenModule: (id: string) => void;
}) {
  const canShift = a.kind === "K" && a.date?.length === 10 && (a.status === "geplant" || a.status === "in_arbeit");
  const graded = a.status === "bestanden" || a.status === "nicht_bestanden";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-t border-border first:border-t-0 break-inside-avoid">
      <span className="w-7 h-7 shrink-0 rounded-md bg-accent/10 text-accent grid place-items-center text-xs font-semibold" title={t(`plan.kind.${a.kind}`)}>
        {a.kind}
      </span>
      <div className="flex-1 min-w-[12rem]">
        <div className="text-sm font-medium leading-snug">
          {a.title}
          {a.attempt > 1 && <span className="ml-2 text-xs text-amber-600">{t("plan.attempt", { n: a.attempt })}</span>}
        </div>
        <div className="text-xs text-neutral-500 flex flex-wrap gap-x-2">
          {module && (
            <button type="button" className="font-mono hover:text-accent" onClick={() => onOpenModule(module.id)}>
              {module.code ?? module.name}
            </button>
          )}
          <span className="tabular-nums">{formatDate(a.date)}</span>
          {slot?.estimate && <span className="text-amber-600" title={t("plan.tbaHint")}>TBA</span>}
          {a.note && <span className="truncate max-w-[20rem]">{a.note}</span>}
        </div>
      </div>
      {graded && (
        <input
          className="input !w-16 !py-1 text-sm tabular-nums print:hidden"
          defaultValue={a.grade != null ? String(a.grade).replace(".", ",") : ""}
          placeholder={t("plan.grade")}
          aria-label={t("plan.grade")}
          onBlur={(e) => {
            const v = e.target.value.trim().replace(",", ".");
            const g = v ? Number(v) : null;
            if (g !== a.grade && (g === null || (g >= 1 && g <= 5))) onGrade(g);
          }}
        />
      )}
      {graded && a.grade != null && <span className="hidden print:inline text-sm tabular-nums">{String(a.grade).replace(".", ",")}</span>}
      <select className={cn("input !w-auto !py-1 text-sm print:hidden", STATUS_TONE[a.status])} value={a.status} onChange={(e) => onStatus(e.target.value as AssessmentStatus)}>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`plan.status.${s}`)}
          </option>
        ))}
      </select>
      <span className={cn("hidden print:inline text-sm", STATUS_TONE[a.status])}>{t(`plan.status.${a.status}`)}</span>
      <div className="flex gap-1 print:hidden">
        {canShift && (
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={onShift} title={t("plan.shiftHint")}>
            ⇥
          </button>
        )}
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={onEdit} aria-label={t("common.edit")}>
          ✎
        </button>
      </div>
    </li>
  );
}
