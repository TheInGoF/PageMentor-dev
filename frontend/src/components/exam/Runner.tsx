// Laufende Prüfung mit Zeitlimit
import { useEffect, useRef, useState } from "react";
import { type ExamSession } from "../../lib/api";
import { Button } from "../ui/Button";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";
import { ClampedQuestion } from "./ClampedQuestion";
import { formatMs } from "./History";

export function ExamSessionRunner({
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
    // Unbeantwortete als leere Einträge, damit die Auswertung sie zeigt
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
              <div className="text-xs uppercase tracking-wide text-accent">
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
