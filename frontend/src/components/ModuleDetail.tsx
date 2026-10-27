import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Card,
  type ModuleDetail as ModuleDetailData,
  type ModuleExam,
} from "../lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { t, useLocale } from "../lib/i18n";
import { cn } from "../lib/cn";
import { CardReview } from "./CardReview";
import { Documents, CardsPanel, ExamsPanel, AudioPanel, SummariesPanel } from "./module/ModulePanels";

type Tab = "overview" | "documents" | "cards" | "exams" | "audio" | "summaries";

const TABS: Array<{ id: Tab; key: string }> = [
  { id: "overview", key: "module.tab.overview" },
  { id: "documents", key: "module.tab.documents" },
  { id: "cards", key: "module.tab.cards" },
  { id: "exams", key: "module.tab.exams" },
  { id: "audio", key: "module.tab.audio" },
  { id: "summaries", key: "module.tab.summaries" },
];

interface Props {
  moduleId: string;
  onBack: () => void;
  onOpenDocument: (docId: string) => void;
  onOpenSettings: () => void;
}

export function ModuleDetail({
  moduleId,
  onBack,
  onOpenDocument,
  onOpenSettings,
}: Props) {
  useLocale();
  const [data, setData] = useState<ModuleDetailData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [reviewing, setReviewing] = useState<Card[] | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api.modules.get(moduleId));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }, [moduleId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function startReview() {
    try {
      // Use per-doc due cards API and flatten.
      const all: Card[] = [];
      if (!data) return;
      for (const doc of data.documents) {
        const due = await api.cards.due(doc.id);
        all.push(...due);
      }
      // Shuffle across documents so review isn't grouped.
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
      if (all.length === 0) {
        toast.show(t("cards.learnNoneDue"), "success");
        return;
      }
      setReviewing(all);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  if (!data) {
    return (
      <div className="min-h-full grid place-items-center text-sm text-neutral-500">
        {t("common.loading")}
      </div>
    );
  }

  const { module: m } = data;

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-black/90 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-4">
          <Button variant="ghost" onClick={onBack} className="!px-2">
            ← {t("module.back")}
          </Button>
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className="flex-shrink-0 w-9 h-9 rounded-lg grid place-items-center text-lg"
              style={{ background: m.color + "22" }}
            >
              {m.icon}
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold truncate">{m.name}</h1>
              {m.semester && (
                <p className="text-xs text-neutral-500">{m.semester}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              onClick={onOpenSettings}
              className="!px-2"
              title={t("settings.title")}
              aria-label={t("settings.title")}
            >
              ⚙
            </Button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={
                "px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap " +
                (tab === tb.id
                  ? "border-accent text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-200")
              }
              style={tab === tb.id ? { borderBottomColor: m.color } : undefined}
            >
              {t(tb.key)}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 flex flex-col gap-5">
        {tab === "overview" && (
          <Overview data={data} onOpenDocument={onOpenDocument} onStartReview={startReview} />
        )}
        {tab === "documents" && (
          <Documents data={data} onOpen={onOpenDocument} />
        )}
        {tab === "cards" && (
          <CardsPanel data={data} onStart={startReview} />
        )}
        {tab === "exams" && <ExamsPanel exams={data.exams} />}
        {tab === "audio" && (
          <AudioPanel chapters={data.audioChapters} color={m.color} />
        )}
        {tab === "summaries" && <SummariesPanel summaries={data.summaries} />}
      </main>

      {reviewing && (
        <CardReview
          cards={reviewing}
          onClose={async () => {
            setReviewing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function Overview({
  data,
  onOpenDocument,
  onStartReview,
}: {
  data: ModuleDetailData;
  onOpenDocument: (id: string) => void;
  onStartReview: () => void;
}) {
  const { module: m, documents, cardStats, exams, audioChapters, summaries } = data;
  const closedExams = exams.filter((e) => e.status === "closed");
  const latestExams = closedExams.slice(0, 10).reverse();

  return (
    <>
      {m.description && (
        <section className="card p-5">
          <p className="text-sm text-neutral-300 whitespace-pre-wrap">
            {m.description}
          </p>
        </section>
      )}

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label={t("module.stats.docs")} value={documents.length} color={m.color} />
        <StatCard label={t("module.stats.cards")} value={cardStats.total} color={m.color} />
        <StatCard
          label={t("module.stats.due")}
          value={cardStats.due}
          color={m.color}
          accent={cardStats.due > 0}
        />
        <StatCard
          label={t("module.stats.audio")}
          value={audioChapters.length}
          color={m.color}
        />
        <StatCard label={t("module.stats.exams")} value={closedExams.length} color={m.color} />
      </section>

      <section className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={onStartReview}
          disabled={cardStats.due === 0}
          style={cardStats.due > 0 ? { background: m.color } : undefined}
        >
          {cardStats.due > 0 ? t("module.learn") : t("module.learnNone")}
        </Button>
        {cardStats.due > 0 && (
          <span className="text-xs text-neutral-500">
            {cardStats.due}/{cardStats.total}
          </span>
        )}
      </section>

      {latestExams.length >= 2 && (
        <section className="card p-5">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-3">
            {t("exam.history")}
          </h3>
          <ExamSparkline exams={latestExams} color={m.color} />
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-3">
            {t("module.tab.documents")}
          </h3>
          {documents.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {t("modules.empty.hint")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {documents.slice(0, 8).map((d) => (
                <li
                  key={d.id}
                  onClick={() => onOpenDocument(d.id)}
                  className="px-3 py-2 rounded border border-border hover:border-accent cursor-pointer flex items-center gap-3"
                >
                  <span className="tag-accent text-xs">
                    {t(`type.${d.type}`)}
                  </span>
                  <span className="text-sm truncate flex-1">{d.title}</span>
                  <span className="text-xs text-neutral-500 font-mono">
                    {d.chapter_count} {t("learn.tab.chapters").charAt(0).toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-3">
            {t("module.tab.summaries")}
          </h3>
          {summaries.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {t("module.summaries.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {summaries.slice(0, 6).map((s) => (
                <li
                  key={s.id}
                  onClick={() => onOpenDocument(s.document_id)}
                  className="px-3 py-2 rounded border border-border hover:border-accent cursor-pointer"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-accent font-mono">
                      {String(s.chapter_number).padStart(2, "0")}
                    </span>
                    <span className="text-sm truncate">
                      {s.chapter_title || `${t("learn.tab.chapters")} ${s.chapter_number}`}
                    </span>
                    <span className="text-xs text-neutral-500 ml-auto">
                      {t(`summary.level.${s.level}`)}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500 truncate mt-0.5">
                    {s.document_title}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

function StatCard({
  label,
  value,
  color,
  accent,
}: {
  label: string;
  value: number;
  color: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "card p-4 text-center",
        accent && value > 0 && "border-accent-subtle bg-accent/5"
      )}
    >
      <div
        className="text-2xl font-semibold"
        style={{ color: accent && value > 0 ? color : undefined }}
      >
        {value}
      </div>
      <div className="text-xs text-neutral-500 mt-1">{label}</div>
    </div>
  );
}

function ExamSparkline({
  exams,
  color,
}: {
  exams: ModuleExam[];
  color: string;
}) {
  const vals = exams.map((e) => e.score ?? 0);
  const w = 600;
  const h = 60;
  const step = vals.length > 1 ? w / (vals.length - 1) : 0;
  const points = vals.map((v, i) => `${i * step},${h - (v / 100) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={points}
        vectorEffect="non-scaling-stroke"
      />
      {vals.map((v, i) => (
        <circle
          key={i}
          cx={i * step}
          cy={h - (v / 100) * h}
          r="3"
          fill={color}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
