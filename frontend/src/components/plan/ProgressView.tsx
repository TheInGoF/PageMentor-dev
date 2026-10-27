// Fortschritt: Lernzeit als Heatmap (eine Farbe, hell → kräftig) und Minuten je Modul
import { useEffect, useMemo, useState } from "react";
import { api, type ModuleListItem, type StudyTimeInfo } from "../../lib/api";
import { t } from "../../lib/i18n";

const WEEKS = 26;
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
// Stufen der Akzentfarbe; 0 Minuten bleibt Fläche
const LEVELS = [0, 15, 45, 90, 150];
const OPACITY = ["", "bg-accent/20", "bg-accent/40", "bg-accent/65", "bg-accent"];

function level(min: number): number {
  let l = 0;
  LEVELS.forEach((v, i) => min > v - 1 && v > 0 && (l = i));
  return min > 0 ? Math.max(1, l) : 0;
}

export function ProgressView({ modules }: { modules: ModuleListItem[] }) {
  const [data, setData] = useState<StudyTimeInfo | null>(null);
  const end = useMemo(() => new Date(), []);
  // Start auf einen Montag, damit die Spalten Wochen sind
  const start = useMemo(() => {
    const d = new Date(end.getTime() - (WEEKS * 7 - 1) * DAY);
    return new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY);
  }, [end]);

  useEffect(() => {
    void api.plan.time(iso(start), iso(end)).then(setData);
  }, [start, end]);

  if (!data) return <div className="text-sm text-neutral-500">{t("common.loading")}</div>;

  const byDay = new Map(data.perDay.map((d) => [d.date, d.minutes]));
  const days: Array<{ date: string; minutes: number }> = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + DAY)) days.push({ date: iso(d), minutes: byDay.get(iso(d)) ?? 0 });
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const last7 = days.slice(-7).reduce((s, d) => s + d.minutes, 0);
  const last30 = days.slice(-30).reduce((s, d) => s + d.minutes, 0);
  const activeDays = days.filter((d) => d.minutes > 0).length;
  const perModule = [...data.perModule].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const max = Math.max(1, ...perModule.map((m) => m.minutes));
  const name = (id: string | null) => {
    const m = modules.find((x) => x.id === id);
    return m ? m.code ?? m.name : t("plan.general");
  };
  const h = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          [t("plan.time.week"), h(last7)],
          [t("plan.time.month"), h(last30)],
          [t("plan.time.activeDays", { n: WEEKS }), String(activeDays)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <div className="text-xs text-neutral-500">{label}</div>
            <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
          </div>
        ))}
      </div>

      <section className="card p-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t("plan.time.heatmap")}</h3>
        <div className="flex gap-[3px] overflow-x-auto pb-1" role="img" aria-label={t("plan.time.heatmap")}>
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {w.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date.split("-").reverse().join(".")}: ${d.minutes} min`}
                  className={`w-3.5 h-3.5 rounded-[3px] ${d.minutes ? OPACITY[level(d.minutes)] : "bg-bg-elevated border border-border"}`}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          {t("plan.time.less")}
          {OPACITY.map((c, i) => (
            <span key={i} className={`w-3 h-3 rounded-[3px] ${c || "bg-bg-elevated border border-border"}`} />
          ))}
          {t("plan.time.more")}
        </div>
      </section>

      <section className="card p-4 flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("plan.time.perModule")}</h3>
        {!perModule.length && <p className="text-sm text-neutral-500">{t("plan.time.none")}</p>}
        {perModule.map((m) => (
          <div key={m.module_id ?? "-"} className="grid grid-cols-[6rem_1fr_6rem] items-center gap-3 text-sm" title={`${name(m.module_id)}: ${h(m.minutes)}`}>
            <span className="font-mono text-xs truncate">{name(m.module_id)}</span>
            <div className="h-2.5 rounded-full bg-bg-elevated overflow-hidden">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(m.minutes / max) * 100}%` }} />
            </div>
            <span className="text-xs text-neutral-500 tabular-nums text-right">{h(m.minutes)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
