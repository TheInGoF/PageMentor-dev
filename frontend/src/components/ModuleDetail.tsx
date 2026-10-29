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
import { AudioPanel } from "./module/ModulePanels";
import { PracticePanel } from "./module/PracticePanel";
import { LearnPanel } from "./module/LearnPanel";
import { resolveModuleTab, takeModuleTab, type ModuleTab, type ModuleTarget, type ModuleView } from "../lib/moduleTab";
import { ModuleEditModal } from "./module/ModuleEditModal";
import { OverviewNext } from "./module/OverviewNext";
import { formatDate } from "./plan/AssessmentRow";

// Vier Reiter nach dem Styleguide: höchstens zwei Ebenen, Unterbereiche als Chips
const TABS: Array<{ id: ModuleView; key: string }> = [
  { id: "overview", key: "module.tab.overview" },
  { id: "learn", key: "module.tab.learn" },
  { id: "practice", key: "module.tab.practice" },
  { id: "audio", key: "module.tab.listen" },
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
  const [target, setTarget] = useState<ModuleTarget>(() => takeModuleTab() ?? { view: "overview" });
  const tab = target.view;
  const setTab = (next: ModuleView) => setTarget({ view: next });
  const [reviewing, setReviewing] = useState<Card[] | null>(null);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<{ label: string; passed: boolean } | null>(null);

  // Status aus den Leistungen: bestanden (mit Note) oder nächster Termin
  useEffect(() => {
    void api.plan.list().then(({ assessments }) => {
      const own = assessments.filter((a) => a.module_id === moduleId && a.kind !== "H");
      const passed = own.find((a) => a.status === "bestanden");
      const next = own.filter((a) => a.date && !["bestanden", "nicht_bestanden", "abgemeldet"].includes(a.status)).sort((a, b) => a.date!.localeCompare(b.date!))[0];
      if (passed) setStatus({ label: `${t("plan.status.bestanden")}${passed.grade ? ` · ${String(passed.grade).replace(".", ",")}` : ""}`, passed: true });
      else if (next) setStatus({ label: `${t(`plan.kind.${next.kind}`)} ${formatDate(next.date)}`, passed: false });
      else setStatus(null);
    });
  }, [moduleId]);

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
              {/* Kopf wie in der Modul-Vorlage: Kürzel, CP, Status bzw. nächster Termin */}
              <p className="text-xs text-neutral-500 flex flex-wrap gap-x-2">
                {m.code && <span className="font-mono">{m.code}</span>}
                {m.cp != null && <span>{m.cp} CP</span>}
                {status && <span className={status.passed ? "text-green-600" : ""}>{status.label}</span>}
                {!m.code && m.semester && <span>{m.semester}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" onClick={() => setEditing(true)} className="!px-2" title={t("common.edit")} aria-label={t("common.edit")}>
              ✎
            </Button>
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
          <Overview data={data} onStartReview={startReview} onTab={(next) => setTarget(resolveModuleTab(next))} />
        )}
        {tab === "learn" && (
          <LearnPanel key={JSON.stringify(target)} data={data} initial={target.learn} initialDoc={target.docId} onOpenDocument={onOpenDocument} />
        )}
        {tab === "practice" && (
          <PracticePanel
            key={JSON.stringify(target)}
            data={data}
            initial={target.practice}
            initialDoc={target.docId}
            onStartReview={startReview}
            onOpenDocument={onOpenDocument}
          />
        )}
        {tab === "audio" && (
          <AudioPanel chapters={data.audioChapters} color={m.color} />
        )}

      </main>

      <ModuleEditModal
        open={editing}
        module={m}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          void load();
        }}
      />

      {reviewing && (
        <CardReview
          cards={reviewing}
          moduleId={m.id}
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
  onStartReview,
  onTab,
}: {
  data: ModuleDetailData;
  onStartReview: () => void;
  onTab: (tab: ModuleTab) => void;
}) {
  const { module: m, documents, cardStats, exams, audioChapters } = data;
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

      <OverviewNext moduleId={m.id} due={cardStats.due} docs={documents.length} onTab={onTab} />
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
