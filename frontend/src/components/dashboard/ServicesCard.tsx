// Dienste auf der Startseite: Zustand der Engine auf einen Blick
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { useEngineStatus } from "../engine/useEngineStatus";

const DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
  skipped: "bg-neutral-600",
};

export function ServicesCard({ onOpen }: { onOpen: () => void }) {
  const { status } = useEngineStatus();
  const results = status?.results ?? [];
  const bad = results.filter((r) => r.status === "error").length;
  const task = status?.task;

  return (
    <button type="button" onClick={onOpen} className="card card-hover p-6 text-left flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500 flex-1">{t("dash.services")}</span>
        <span className={cn("text-xs", bad ? "text-red-400" : "text-emerald-400")}>
          {!results.length ? t("common.loading") : bad ? t("dash.services.bad", { n: bad }) : t("dash.services.ok")}
        </span>
      </div>
      {task && (
        <div className="text-sm">
          {task.title}: <span className="text-neutral-400">{task.message}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {results.map((r) => (
          <span key={r.id} className="flex items-center gap-2 text-xs text-neutral-400" title={r.message}>
            <span className={cn("w-2 h-2 rounded-full", DOT[r.status])} />
            {r.title}
          </span>
        ))}
      </div>
    </button>
  );
}
