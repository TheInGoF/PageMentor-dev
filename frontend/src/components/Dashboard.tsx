import { useEffect, useState } from "react";
import { api, type DashboardData } from "../lib/api";
import { useToast } from "./ui/Toast";
import { t, useLocale } from "../lib/i18n";
import { cn } from "../lib/cn";
import { TopBar } from "./TopBar";
import { FocusCard } from "./dashboard/FocusCard";
import { useNav } from "../lib/nav";
import { ServicesCard } from "./dashboard/ServicesCard";

interface Props {
  onOpenDocument: (docId: string) => void;
  onOpenSettings: () => void;
  // Engine-Einstellungen direkt öffnen
  onOpenEngine?: () => void;
  onOpenModule?: (id: string) => void;
}

export function Dashboard({
  onOpenDocument,
  onOpenSettings,
  onOpenEngine,
  onOpenModule,
}: Props) {
  useLocale();
  const [data, setData] = useState<DashboardData | null>(null);
  const toast = useToast();
  const nav = useNav();
  const [minutes7, setMinutes7] = useState<number | null>(null);
  const [cp, setCp] = useState<string | null>(null);

  useEffect(() => {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    void api.plan.time(day(6), day(0)).then((r) => setMinutes7(r.perDay.reduce((sum, d) => sum + d.minutes, 0))).catch(() => undefined);
    void api.plan.progress().then((p) => setCp(p.totalCp ? `${p.earnedCp} / ${p.totalCp}` : String(p.earnedCp))).catch(() => undefined);
  }, []);

  useEffect(() => {
    api.dashboard
      .get()
      .then(setData)
      .catch((err) => {
        if (import.meta.env.DEV) {
          // UI review mode: render the dashboard shell with zeros.
          setData(emptyDashboard());
          return;
        }
        toast.show(err instanceof Error ? err.message : t("common.error"), "error");
      });
  }, [toast]);

  return (
    <div className="min-h-full flex flex-col">
      <TopBar
        onOpenDocument={onOpenDocument}
        onOpenSettings={onOpenSettings}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col gap-6">
        <section>
          <h1 className="text-2xl font-semibold">{t("dash.title")}</h1>
          <p className="text-sm text-neutral-500 mt-1">{t("dash.subtitle")}</p>
        </section>

        {onOpenModule && <FocusCard onOpenModule={onOpenModule} />}

        {!data ? (
          <div className="text-sm text-neutral-500">{t("common.loading")}</div>
        ) : (
          <>
            {/* Vier Kennzahlen; Verlauf und Heatmap stehen unter Plan → Fortschritt */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label={t("dash.stats.due")} value={data.totals.due} accent={data.totals.due > 0} />
              <StatCard label={t("dash.stats.week")} value={minutes7 != null ? `${Math.floor(minutes7 / 60)} h ${minutes7 % 60} min` : "–"} onClick={() => nav?.go("plan")} />
              <StatCard label={t("dash.stats.streak")} value={`${data.streak} ${t("dash.days")}`} />
              <StatCard label={t("plan.cp")} value={cp ?? "–"} onClick={() => nav?.go("plan")} />
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <WeakTopicsCard
                data={data}
                onOpen={(docId) => {
                  onOpenDocument(docId);
                }}
              />
              <RecentCard data={data} onOpen={onOpenDocument} />
            </section>

            <ServicesCard onOpen={onOpenEngine ?? onOpenSettings} />
          </>
        )}
      </main>
    </div>
  );
}

function emptyDashboard(): DashboardData {
  const today = new Date();
  const activity = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));
    return { date: d.toISOString().slice(0, 10), count: 0, avgQuality: 0 };
  });
  return {
    totals: { documents: 0, cards: 0, due: 0, learned: 0, audio_done: 0, exams: 0, exam_avg_score: 0 },
    streak: 0,
    activity,
    weakTopics: [],
    recent: [],
  };
}

function StatCard({
  label,
  value,
  accent,
  onClick,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  onClick?: () => void;
}) {
  const hot = accent && typeof value === "number" && value > 0;
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={cn("card p-4 text-left", onClick && "card-hover", hot && "border-accent/30 bg-accent/5")}
    >
      <div className={cn("text-2xl font-semibold tabular-nums", hot && "text-accent")}>{value}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
    </button>
  );
}

function WeakTopicsCard({
  data,
  onOpen,
}: {
  data: DashboardData;
  onOpen: (docId: string) => void;
}) {
  return (
    <div className="card p-5">
      <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-4">
        {t("dash.weak.title")}
      </h3>
      {data.weakTopics.length === 0 ? (
        <p className="text-xs text-neutral-500">{t("dash.weak.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.weakTopics.map((w) => (
            <li
              key={w.chapter_id}
              className="px-3 py-2 rounded border border-border hover:border-accent cursor-pointer"
              onClick={() => onOpen(w.document_id)}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-accent font-mono text-xs">
                  {String(w.chapter_number).padStart(2, "0")}
                </span>
                <span className="text-sm font-medium truncate">
                  {w.chapter_title || `Kap. ${w.chapter_number}`}
                </span>
              </div>
              <div className="text-xs text-neutral-500 mt-0.5">
                {w.document_title} ·{" "}
                {t("dash.weak.subtitle", {
                  count: w.low_quality_count,
                  ease: w.avg_ease.toFixed(1),
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentCard({
  data,
  onOpen,
}: {
  data: DashboardData;
  onOpen: (docId: string) => void;
}) {
  return (
    <div className="card p-5">
      <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-4">
        {t("dash.recent.title")}
      </h3>
      {data.recent.length === 0 ? (
        <p className="text-xs text-neutral-500">{t("dash.recent.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.recent.map((r) => (
            <li
              key={r.id}
              className="px-3 py-2 rounded border border-border hover:border-accent cursor-pointer flex items-center gap-3"
              onClick={() => onOpen(r.id)}
            >
              <span className="tag-accent text-xs uppercase">
                {t(`type.${r.type}`)}
              </span>
              <span className="text-sm font-medium truncate flex-1">{r.title}</span>
              <span className="text-xs text-neutral-500 font-mono">
                {r.page_count > 0 ? `${r.page_count}${t("library.pagesShort")}` : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
