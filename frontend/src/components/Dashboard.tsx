import { useEffect, useState } from "react";
import { api, type DashboardData } from "../lib/api";
import { useToast } from "./ui/Toast";
import { t, useLocale } from "../lib/i18n";
import { cn } from "../lib/cn";
import { TopBar } from "./TopBar";

interface Props {
  onOpenLibrary: () => void;
  onOpenModules: () => void;
  onOpenDocument: (docId: string) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenLogs?: () => void;
}

export function Dashboard({
  onOpenLibrary,
  onOpenModules,
  onOpenDocument,
  onLogout,
  onOpenSettings,
  onOpenLogs,
}: Props) {
  useLocale();
  const [data, setData] = useState<DashboardData | null>(null);
  const toast = useToast();

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
        onLogout={onLogout}
        onOpenDocument={onOpenDocument}
        currentView="dashboard"
        onGoDashboard={() => {}}
        onGoLibrary={onOpenLibrary}
        onGoModules={onOpenModules}
        onOpenSettings={onOpenSettings}
        onOpenLogs={onOpenLogs}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col gap-6">
        <section>
          <h1 className="text-2xl font-semibold">{t("dash.title")}</h1>
          <p className="text-sm text-neutral-500 mt-1">{t("dash.subtitle")}</p>
        </section>

        {!data ? (
          <div className="text-sm text-neutral-500">{t("common.loading")}</div>
        ) : (
          <>
            <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <StatCard label={t("dash.stats.documents")} value={data.totals.documents} />
              <StatCard label={t("dash.stats.cards")} value={data.totals.cards} />
              <StatCard
                label={t("dash.stats.due")}
                value={data.totals.due}
                accent={data.totals.due > 0}
              />
              <StatCard label={t("dash.stats.learned")} value={data.totals.learned} />
              <StatCard label={t("dash.stats.audio")} value={data.totals.audio_done} />
              <StatCard label={t("dash.stats.exams")} value={data.totals.exams} />
              <StatCard
                label={t("dash.stats.avgScore")}
                value={data.totals.exams > 0 ? `${Math.round(data.totals.exam_avg_score)}%` : "—"}
              />
            </section>

            <section className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4">
              <StreakCard streak={data.streak} />
              <ActivityCard activity={data.activity} />
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
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "card p-4",
        accent && typeof value === "number" && value > 0 && "border-accent-subtle bg-accent/5"
      )}
    >
      <div
        className={cn(
          "text-2xl font-semibold",
          accent && typeof value === "number" && value > 0 && "text-accent"
        )}
      >
        {value}
      </div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
    </div>
  );
}

function StreakCard({ streak }: { streak: number }) {
  return (
    <div className="card p-5 flex flex-col justify-between min-h-[140px]">
      <div>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
          {t("dash.streak.title")}
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold text-accent">{streak}</span>
          <span className="text-sm text-neutral-400">
            {t("dash.streak.days", { n: streak })}
          </span>
        </div>
      </div>
      {streak === 0 && (
        <p className="text-xs text-neutral-500 mt-3">{t("dash.streak.none")}</p>
      )}
      <div className="flex gap-0.5 mt-3">
        {Array.from({ length: 14 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 h-5 rounded-sm",
              i < streak ? "bg-accent" : "bg-bg-elevated border border-border"
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ActivityCard({ activity }: { activity: DashboardData["activity"] }) {
  const max = Math.max(1, ...activity.map((a) => a.count));
  const empty = activity.every((a) => a.count === 0);

  return (
    <div className="card p-5">
      <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-4">
        {t("dash.activity.title")}
      </h3>
      {empty ? (
        <p className="text-xs text-neutral-500">{t("dash.activity.empty")}</p>
      ) : (
        <>
          <div className="flex items-end gap-0.5 h-24">
            {activity.map((day) => (
              <div
                key={day.date}
                className="flex-1 bg-accent/60 rounded-sm transition-colors hover:bg-accent"
                style={{
                  height: `${(day.count / max) * 100}%`,
                  minHeight: day.count > 0 ? "4px" : "2px",
                  background:
                    day.count === 0 ? "rgba(64,64,64,0.4)" : undefined,
                }}
                title={`${day.date}: ${day.count}`}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-neutral-500 mt-1 font-mono">
            <span>{activity[0]?.date.slice(5)}</span>
            <span>{activity[activity.length - 1]?.date.slice(5)}</span>
          </div>
        </>
      )}
    </div>
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
              <div className="text-[11px] text-neutral-500 mt-0.5">
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
              <span className="tag-accent text-[10px] uppercase">
                {t(`type.${r.type}`)}
              </span>
              <span className="text-sm font-medium truncate flex-1">{r.title}</span>
              <span className="text-[11px] text-neutral-500 font-mono">
                {r.page_count > 0 ? `${r.page_count}${t("library.pagesShort")}` : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
