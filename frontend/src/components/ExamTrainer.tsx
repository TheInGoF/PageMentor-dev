import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ExamSession, type ExamSessionSummary, type ReviewQuality } from "../lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { cn } from "../lib/cn";
import { getSettings } from "../lib/settings";
import { currentLocale, t } from "../lib/i18n";

interface Props {
  docId: string;
}

type Mode = "idle" | "running" | "review" | "done";

const COUNT_OPTIONS = [10, 20, 30, 50];
const DURATION_OPTIONS: Array<{ value: number; labelKey?: string; minutes?: number }> = [
  { value: 30, minutes: 30 },
  { value: 60, minutes: 60 },
  { value: 90, minutes: 90 },
  { value: 120, minutes: 120 },
  { value: 0, labelKey: "exam.duration.noLimit" },
];

export function ExamTrainer({ docId }: Props) {
  const [history, setHistory] = useState<ExamSessionSummary[] | null>(null);
  const [count, setCount] = useState(() => getSettings().defaultExamCount);
  const [minutes, setMinutes] = useState(() => getSettings().defaultExamMinutes);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [takenMs, setTakenMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.exam
      .history(docId)
      .then(setHistory)
      .catch((err) => toast.show(err instanceof Error ? err.message : t("common.error"), "error"));
  }, [docId, toast]);

  async function start() {
    setBusy(true);
    try {
      const { id } = await api.exam.start(docId, {
        count,
        durationMs: minutes > 0 ? minutes * 60_000 : undefined,
      });
      const full = await api.exam.get(id);
      setSession(full);
      setMode("running");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteHistory(sessionId: string) {
    if (!confirm(t("exam.history.deleteConfirm"))) return;
    try {
      await api.exam.remove(sessionId);
      setHistory(await api.exam.history(docId));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  if (mode === "running" && session) {
    return (
      <ExamSessionRunner
        session={session}
        plannedDurationMs={minutes > 0 ? minutes * 60_000 : null}
        onFinish={(answers, takenMs) => {
          setSession({ ...session, answers });
          reviewAndSubmit(session.id, answers, takenMs);
        }}
        onCancel={async () => {
          setSession(null);
          setMode("idle");
          setHistory(await api.exam.history(docId));
        }}
      />
    );

    async function reviewAndSubmit(
      _sessionId: string,
      answers: Record<string, { text: string }>,
      elapsedMs: number
    ) {
      // Transition to review mode with current answers, user will self-grade.
      if (!session) return;
      setSession({
        ...session!,
        answers: Object.fromEntries(Object.entries(answers)),
      });
      setTakenMs(elapsedMs);
      setMode("review");
    }
  }

  if (mode === "review" && session) {
    return (
      <ExamReview
        session={session}
        takenMs={takenMs}
        onSubmitted={async (score) => {
          toast.show(t("exam.review.submitted", { score }), "success");
          setSession(null);
          setMode("idle");
          setHistory(await api.exam.history(docId));
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-1">{t("exam.title")}</h2>
        <p className="text-xs text-neutral-500 mb-5">{t("exam.subtitle")}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="text-xs font-medium text-neutral-400 block mb-2">
              {t("exam.count")}
            </label>
            <div className="flex gap-2 flex-wrap">
              {COUNT_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={chipClass(count === n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-400 block mb-2">
              {t("exam.duration")}
            </label>
            <div className="flex gap-2 flex-wrap">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setMinutes(opt.value)}
                  className={chipClass(minutes === opt.value)}
                >
                  {opt.labelKey ? t(opt.labelKey) : `${opt.minutes} min`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-4 mt-4 border-t border-border">
          <Button onClick={start} disabled={busy}>
            {busy ? t("exam.starting") : t("exam.start")}
          </Button>
        </div>
      </section>

      <History history={history} onDelete={deleteHistory} />
    </div>
  );
}

function chipClass(active: boolean): string {
  return cn(
    "px-4 py-1.5 rounded-full text-xs border transition-colors",
    active
      ? "bg-accent/15 border-accent-subtle text-accent"
      : "border-border text-neutral-400 hover:border-border-strong"
  );
}

function ExamSessionRunner({
  session,
  plannedDurationMs,
  onFinish,
  onCancel,
}: {
  session: ExamSession;
  plannedDurationMs: number | null;
  onFinish: (answers: Record<string, { text: string }>, takenMs: number) => void;
  onCancel: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const iv = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    return () => clearInterval(iv);
  }, []);

  const timeUp =
    plannedDurationMs !== null && elapsed >= plannedDurationMs && plannedDurationMs > 0;

  useEffect(() => {
    if (timeUp) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

  const card = session.cards[idx];
  const total = session.cards.length;

  function setAnswer(text: string) {
    if (!card) return;
    setAnswers((a) => ({ ...a, [card.id]: text }));
  }

  function submit() {
    const formatted = Object.fromEntries(
      Object.entries(answers).map(([id, text]) => [id, { text }])
    );
    // Also add empty entries for unanswered so review sees them
    for (const c of session.cards) {
      if (!formatted[c.id]) formatted[c.id] = { text: "" };
    }
    onFinish(formatted, Date.now() - startedAt.current);
  }

  if (!card) {
    return <div className="text-sm text-neutral-500">{t("exam.review.noCards")}</div>;
  }

  const remaining =
    plannedDurationMs !== null && plannedDurationMs > 0
      ? Math.max(0, plannedDurationMs - elapsed)
      : null;

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-black/95 backdrop-blur">
        <div className="h-14 flex items-center gap-3 px-4 md:px-6">
          <div className="hidden md:block text-xs uppercase tracking-wide text-neutral-500 shrink-0">
            {t("exam.title")}
          </div>
          <div className="flex-1 h-1 bg-bg-elevated rounded overflow-hidden min-w-[60px]">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${((idx + 1) / total) * 100}%` }}
            />
          </div>
          <div className="text-xs font-mono text-neutral-400 shrink-0">
            {idx + 1} / {total}
          </div>
          <div
            className={cn(
              "text-xs font-mono px-2 py-1 rounded shrink-0",
              remaining !== null && remaining < 60_000
                ? "bg-accent/20 text-accent"
                : "text-neutral-400"
            )}
          >
            {remaining !== null ? formatMs(remaining) : formatMs(elapsed)}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={() => setIdx(Math.max(0, idx - 1))}
              disabled={idx === 0}
              className="!px-3 !py-1.5 text-xs"
            >
              ← {t("exam.prev")}
            </Button>
            {idx + 1 < total ? (
              <Button
                onClick={() => setIdx(idx + 1)}
                className="!px-3 !py-1.5 text-xs"
              >
                {t("exam.next")} →
              </Button>
            ) : (
              <Button onClick={submit} className="!px-3 !py-1.5 text-xs">
                {t("exam.submit")}
              </Button>
            )}
          </div>
          <button
            onClick={() => {
              if (confirm(t("exam.cancelConfirm"))) onCancel();
            }}
            className="text-neutral-500 hover:text-accent text-xl leading-none shrink-0 ml-1"
            aria-label={t("exam.cancel")}
          >
            ×
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl mx-auto flex flex-col gap-5">
          <section className="card p-6 flex flex-col gap-3">
            {card.chapter_number != null && (
              <div className="text-[11px] uppercase tracking-wide text-accent">
                {t("review.chapterTag", {
                  num: String(card.chapter_number).padStart(2, "0"),
                  sep: card.chapter_title ? " · " : "",
                  title: card.chapter_title ?? "",
                })}
              </div>
            )}
            <ClampedQuestion text={card.question} />
          </section>

          <div>
            <label className="text-xs font-medium text-neutral-400 mb-2 block">
              {t("exam.answerLabel")}
            </label>
            <textarea
              className="input min-h-[160px] resize-y font-mono"
              value={answers[card.id] ?? ""}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={t("exam.answerPlaceholder")}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function ClampedQuestion({ text }: { text: string }) {
  const LIMIT = 600; // Zeichen — entspricht grob 3–4 Zeilen bei typ. Fragestellungen.
  const [expanded, setExpanded] = useState(false);
  const needsClamp = text.length > LIMIT;
  const shown = !needsClamp || expanded ? text : text.slice(0, LIMIT).trimEnd() + "…";

  return (
    <div className="flex flex-col gap-2">
      <p
        className={cn(
          "text-lg md:text-xl leading-relaxed whitespace-pre-wrap",
          needsClamp && !expanded ? "max-h-[40vh] overflow-y-auto" : ""
        )}
      >
        {shown}
      </p>
      {needsClamp && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-xs text-accent hover:underline"
        >
          {expanded ? t("exam.question.collapse") : t("exam.question.expand")}
        </button>
      )}
    </div>
  );
}

function ExamReview({
  session,
  takenMs,
  onSubmitted,
}: {
  session: ExamSession;
  takenMs: number;
  onSubmitted: (score: number) => void;
}) {
  const [qualities, setQualities] = useState<Record<string, ReviewQuality>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const allRated = session.cards.every((c) => qualities[c.id] != null);

  async function submit() {
    setBusy(true);
    try {
      const answers = Object.fromEntries(
        session.cards.map((c) => [
          c.id,
          { text: session.answers[c.id]?.text ?? "", quality: qualities[c.id] },
        ])
      );
      const res = await api.exam.submit(session.id, { answers, takenMs });
      onSubmitted(res.score);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">{t("exam.review.title")}</h2>
          <p className="text-xs text-neutral-500 mt-1">{t("exam.review.subtitle")}</p>
        </div>
        <Button onClick={submit} disabled={busy || !allRated}>
          {busy ? t("common.saving") : t("exam.review.submit")}
        </Button>
      </section>

      <ul className="flex flex-col gap-3">
        {session.cards.map((card, i) => (
          <li key={card.id} className="card p-4 flex flex-col gap-3">
            <header className="flex items-center gap-3 text-xs text-neutral-500">
              <span className="font-mono text-accent">#{i + 1}</span>
              {card.chapter_number != null && (
                <span>
                  {t("library.chaptersShort")}{" "}
                  {String(card.chapter_number).padStart(2, "0")}
                </span>
              )}
            </header>
            <div>
              <div className="text-xs text-neutral-400 mb-1">{t("cards.field.question")}</div>
              <p className="text-sm">{card.question}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-neutral-400 mb-1">{t("exam.review.yourAnswer")}</div>
                <div className="card p-3 bg-bg-elevated min-h-[70px] text-sm whitespace-pre-wrap">
                  {session.answers[card.id]?.text?.trim() || (
                    <span className="text-neutral-600 italic">{t("exam.review.empty")}</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-400 mb-1">{t("exam.review.reference")}</div>
                <div className="card p-3 bg-accent/5 border-accent-subtle min-h-[70px] text-sm whitespace-pre-wrap">
                  {card.answer?.trim() || (
                    <span className="text-neutral-600 italic">{t("exam.review.noReference")}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <QualityButton
                label={t("review.forgot")}
                accent="text-accent"
                active={qualities[card.id] === 1}
                onClick={() => setQualities({ ...qualities, [card.id]: 1 })}
              />
              <QualityButton
                label={t("review.partial")}
                accent="text-amber-400"
                active={qualities[card.id] === 3}
                onClick={() => setQualities({ ...qualities, [card.id]: 3 })}
              />
              <QualityButton
                label={t("review.known")}
                accent="text-emerald-400"
                active={qualities[card.id] === 5}
                onClick={() => setQualities({ ...qualities, [card.id]: 5 })}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QualityButton({
  label,
  accent,
  active,
  onClick,
}: {
  label: string;
  accent: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border text-center py-2 text-xs transition-colors",
        active
          ? "border-accent bg-accent/10 " + accent
          : "border-border text-neutral-400 hover:border-border-strong"
      )}
    >
      {label}
    </button>
  );
}

function History({
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

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
