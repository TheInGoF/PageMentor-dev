// Verlauf der Prüfungen mit Sparkline
import { useMemo } from "react";
import { type ExamSessionSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { currentLocale, t } from "../../lib/i18n";

export function History({
  history,
  onDelete,
}: {
  history: ExamSessionSummary[] | null;
  onDelete: (id: string) => void;
}) {
  const scoreSeries = useMemo(() => {
    if (!history) return [];
    return history
      .filter((h) => h.status === "closed" && h.score != null)
      .slice()
      .reverse()
      .map((h) => h.score ?? 0);
  }, [history]);

  if (!history) return <div className="text-sm text-neutral-500">{t("common.loading")}</div>;

  const localeCode = currentLocale() === "de" ? "de-DE" : "en-US";

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {t("exam.history")}
        </h3>
        <span className="text-xs text-neutral-500">
          {t("exam.history.count", { n: history.length })}
        </span>
      </div>

      {scoreSeries.length >= 2 && <SparkLine values={scoreSeries} />}

      {history.length === 0 ? (
        <p className="text-sm text-neutral-500">{t("exam.history.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2 mt-3">
          {history.map((h) => (
            <li
              key={h.id}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-border hover:border-border-strong"
            >
              <div className="min-w-0">
                <div className="text-sm truncate">{h.title}</div>
                <div className="text-[11px] text-neutral-500">
                  {new Date(h.created_at).toLocaleString(localeCode)} ·{" "}
                  {h.status === "closed"
                    ? t("exam.history.closed")
                    : t("exam.history.open")}
                  {h.taken_ms ? ` · ${formatMs(h.taken_ms)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "text-lg font-semibold min-w-[3ch] text-right",
                    h.score == null
                      ? "text-neutral-500"
                      : h.score >= 80
                      ? "text-emerald-400"
                      : h.score >= 50
                      ? "text-amber-400"
                      : "text-accent"
                  )}
                >
                  {h.score == null ? t("common.none") : `${h.score}%`}
                </div>
                <button
                  onClick={() => onDelete(h.id)}
                  className="text-xs text-neutral-500 hover:text-accent"
                  aria-label={t("common.delete")}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SparkLine({ values }: { values: number[] }) {
  const w = 360;
  const h = 60;
  const max = 100;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const points = values.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14">
      <polyline
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        points={points}
        vectorEffect="non-scaling-stroke"
      />
      {values.map((v, i) => (
        <circle
          key={i}
          cx={i * step}
          cy={h - (v / max) * h}
          r="3"
          fill="#ef4444"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
