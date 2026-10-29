import { useEffect, useMemo, useState } from "react";
import {
  api,
  type Document,
  type ExamSessionSummary,
  type ModuleListItem,
  type ProgressEvent,
} from "../lib/api";
import { t, currentLocale } from "../lib/i18n";
import { Button } from "./ui/Button";
import { cn } from "../lib/cn";
import type { Tab } from "./LearningMenu";
import type { ModuleTab } from "../lib/moduleTab";

interface Props {
  doc: Document;
  extractionPhase: ProgressEvent | null;
  extractionRunning: boolean;
  extractionBusy: boolean;
  extractionStartedAt: number | null;
  onStartExtraction: (opts?: { forceOcr?: boolean }) => void;
  onCancelExtraction: () => void;
  onGoTo: (tab: Tab) => void;
  // Karten, Zusammenfassungen und Probeklausuren liegen im Modul, mit diesem Heft vorgewählt
  onOpenModule: (tab: ModuleTab) => void;
}

export function DocumentOverview({
  doc,
  extractionPhase,
  extractionRunning,
  extractionBusy,
  extractionStartedAt,
  onStartExtraction,
  onCancelExtraction,
  onGoTo,
  onOpenModule,
}: Props) {
  const [exams, setExams] = useState<ExamSessionSummary[]>([]);
  const [module, setModule] = useState<ModuleListItem | null>(null);

  useEffect(() => {
    api.exam.history(doc.id).then(setExams).catch(() => setExams([]));
  }, [doc.id]);

  useEffect(() => {
    if (!doc.module_id) {
      setModule(null);
      return;
    }
    api.modules
      .list()
      .then((list) => setModule(list.find((m) => m.id === doc.module_id) ?? null))
      .catch(() => setModule(null));
  }, [doc.module_id]);

  const examStats = useMemo(() => {
    const closed = exams.filter((e) => e.status === "closed" && e.score != null);
    const best = closed.reduce((m, e) => Math.max(m, e.score ?? 0), 0);
    return { total: closed.length, best };
  }, [exams]);

  const extractionReady = doc.ocr_status === "done";
  // Üben geht nur im Modul: ohne Zuordnung gesperrt, mit Hinweis
  const inModule = !!doc.module_id;
  const practiceHint = inModule ? undefined : t("overview.needsModule");

  const sizeMb = (doc.size_bytes / 1024 / 1024).toFixed(1);
  const locale = currentLocale() === "de" ? "de-DE" : "en-US";
  const created = new Date(doc.created_at).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Metadata */}
      <section className="card p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="tag-accent uppercase text-xs">{t(`type.${doc.type}`)}</span>
              {module && (
                <span
                  className="tag text-xs"
                  style={{ borderColor: module.color, color: module.color }}
                >
                  {module.icon} {module.name}
                </span>
              )}
              {(doc.tags ?? []).map((tg) => (
                <span key={tg} className="tag text-xs">
                  #{tg}
                </span>
              ))}
            </div>
            <h2 className="text-2xl font-semibold mt-2 break-words">{doc.title}</h2>
            <p className="text-xs text-neutral-500 mt-1 font-mono truncate">
              {doc.filename}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-border">
          <Metric label={t("overview.metric.pages")} value={doc.page_count || "—"} />
          <Metric label={t("overview.metric.size")} value={`${sizeMb} MB`} />
          <Metric label={t("overview.metric.language")} value={doc.language.toUpperCase()} />
          <Metric label={t("overview.metric.created")} value={created} />
        </div>
      </section>

      <ExtractionCard
        doc={doc}
        phase={extractionPhase}
        running={extractionRunning}
        busy={extractionBusy}
        startedAt={extractionStartedAt}
        onStart={onStartExtraction}
        onCancel={onCancelExtraction}
      />

      {/* Eine Liste statt Kacheln: Wert rechts, Klick führt hin; Üben liegt im Modul */}
      <section className="card p-4 flex flex-col divide-y divide-border">
        <StatusRow label={t("overview.chapters.title")} value={doc.chapter_count ?? 0} disabled={!extractionReady} onOpen={() => onGoTo("reader")} />
        <StatusRow label={t("learn.tab.audiobook")} value={`${doc.audio_done ?? 0} / ${doc.audio_total ?? 0}`} disabled={!extractionReady} onOpen={() => onGoTo("audiobook")} />
        <StatusRow label={t("learn.tab.exercises")} value={doc.card_count ?? 0} disabled={!extractionReady || !inModule} onOpen={() => onOpenModule("cards")} />
        <StatusRow label={t("learn.tab.summary")} value={doc.summary_count ?? 0} disabled={!extractionReady || !inModule} onOpen={() => onOpenModule("summaries")} />
        <StatusRow
          label={t("learn.tab.exam")}
          value={examStats.total > 0 ? `${examStats.total} · ${t("overview.exam.best", { score: examStats.best })}` : 0}
          disabled={!extractionReady || !inModule}
          onOpen={() => onOpenModule("exams")}
        />
        {practiceHint && <p className="text-xs text-neutral-500 pt-2">{practiceHint}</p>}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-sm font-medium text-neutral-100 mt-0.5">{value}</div>
    </div>
  );
}

function StatusRow({ label, value, disabled, onOpen }: { label: string; value: number | string; disabled?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="flex items-center gap-4 py-2 text-left text-sm hover:text-accent disabled:opacity-50 disabled:hover:text-inherit"
    >
      <span className="flex-1">{label}</span>
      <span className="text-neutral-500 tabular-nums">{value}</span>
      <span aria-hidden className="text-accent">→</span>
    </button>
  );
}

function ExtractionCard({
  doc,
  phase,
  running,
  busy,
  startedAt,
  onStart,
  onCancel,
}: {
  doc: Document;
  phase: ProgressEvent | null;
  running: boolean;
  busy: boolean;
  startedAt: number | null;
  onStart: (opts?: { forceOcr?: boolean }) => void;
  onCancel: () => void;
}) {
  const status = doc.ocr_status;
  const ready = status === "done";

  // Tick once per second while running — runtime display.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [running]);

  // Docling liefert task_progress als 0.0-1.0 manchmal mit, manchmal nicht.
  // Wenn vorhanden → echter Balken. Sonst: Indeterminate-Pulse.
  const fraction =
    typeof phase?.current === "number" && phase.current > 0 && phase.current <= 1
      ? phase.current
      : null;
  const pct = fraction != null ? Math.round(fraction * 100) : null;
  // For runtime the DB value counts (persistent across page reloads),
  // the SSE-set startedAt is only a fallback for the first event.
  const effectiveStart = doc.extraction_started_at ?? startedAt ?? null;
  const elapsed = effectiveStart != null ? Date.now() - effectiveStart : 0;

  return (
    <div className="card p-5 flex flex-col gap-3 border-accent-subtle">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {t("overview.extraction.title")}
        </h3>
        <StatusBadge status={status} />
      </div>

      <p className="text-sm text-neutral-300">
        {status === "awaiting-extraction" && t("extract.gate.awaiting")}
        {status === "pending" && t("extract.gate.awaiting")}
        {status === "running" && t("extract.gate.running")}
        {status === "failed" && t("extract.gate.failed")}
        {status === "done" && t("overview.extraction.done")}
      </p>

      {running && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-accent font-mono truncate">
              {phase?.message ?? t("extract.gate.running")}
            </span>
            <span className="text-xs text-neutral-500 font-mono shrink-0">
              {pct != null && `${pct}% · `}
              {t("overview.extraction.elapsed", {
                time: formatElapsed(elapsed),
              })}
            </span>
          </div>
          <div className="h-1.5 bg-black/40 rounded overflow-hidden">
            {pct != null ? (
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            ) : (
              <div className="h-full bg-accent/60 animate-pulse w-1/3" />
            )}
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-2">
        {running ? (
          <Button variant="danger" onClick={onCancel} className="!py-1 !px-3 text-xs">
            {t("extract.cancel")}
          </Button>
        ) : ready ? (
          <>
            <button
              type="button"
              onClick={() => {
                if (confirm(t("overview.extraction.rerunConfirm")))
                  onStart({ forceOcr: false });
              }}
              disabled={busy}
              className="text-xs text-neutral-500 hover:text-neutral-300 underline decoration-dotted underline-offset-4 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t("overview.extraction.rerun")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(t("overview.extraction.rerunForceOcrConfirm")))
                  onStart({ forceOcr: true });
              }}
              disabled={busy}
              title={t("overview.extraction.rerunForceOcrHint")}
              className="text-xs text-amber-400/80 hover:text-amber-300 underline decoration-dotted underline-offset-4 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t("overview.extraction.rerunForceOcr")}
            </button>
          </>
        ) : (
          <Button
            onClick={() => onStart()}
            disabled={busy}
            className="!py-1 !px-3 text-xs"
          >
            {status === "failed" ? t("extract.retry") : t("extract.start")}
          </Button>
        )}
      </div>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function StatusBadge({ status }: { status: Document["ocr_status"] }) {
  const color: Record<Document["ocr_status"], string> = {
    "awaiting-extraction": "text-neutral-400 border-border",
    pending: "text-neutral-500 border-border",
    running: "text-amber-400 border-amber-500/40",
    done: "text-emerald-400 border-emerald-500/40",
    failed: "text-accent border-accent-subtle",
  };
  return (
    <span className={cn("tag", color[status])}>
      {t(`ocr.${status}`)}
    </span>
  );
}
