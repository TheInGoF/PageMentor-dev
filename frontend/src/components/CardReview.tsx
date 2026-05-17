import { useEffect, useState } from "react";
import { api, type Card, type ReviewQuality } from "../lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  cards: Card[];
  onClose: () => void;
}

interface SessionEntry {
  card: Card;
  quality: ReviewQuality;
}

export function CardReview({ cards, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [history, setHistory] = useState<SessionEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setShowAnswer((s) => !s);
      } else if (showAnswer && !saving) {
        if (e.key === "1") rate(1);
        else if (e.key === "2") rate(3);
        else if (e.key === "3") rate(5);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, showAnswer, saving]);

  async function rate(quality: ReviewQuality) {
    if (idx >= cards.length) return;
    const card = cards[idx];
    setSaving(true);
    try {
      await api.cards.review(card.id, quality);
      setHistory((h) => [...h, { card, quality }]);
      setShowAnswer(false);
      setShowHint(false);
      setIdx(idx + 1);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  if (idx >= cards.length) {
    return <Summary history={history} onClose={onClose} />;
  }

  const card = cards[idx];
  const progressPct = ((idx + 1) / cards.length) * 100;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <header className="border-b border-border flex items-center gap-4 px-6 h-14">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          {t("review.title")}
        </div>
        <div className="flex-1 h-1 bg-bg-elevated rounded overflow-hidden">
          <div className="h-full bg-accent transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="text-xs text-neutral-400 font-mono">
          {idx + 1} / {cards.length}
        </div>
        <button
          onClick={onClose}
          className="text-neutral-500 hover:text-accent text-2xl leading-none"
        >
          ×
        </button>
      </header>

      <main className="flex-1 grid place-items-center px-6 py-8 overflow-y-auto">
        <div className="w-full max-w-2xl flex flex-col gap-6">
          <section className="card p-6 md:p-8">
            {card.chapter_number && (
              <div className="text-[11px] uppercase tracking-wide text-accent mb-3">
                {t("review.chapterTag", {
                  num: String(card.chapter_number).padStart(2, "0"),
                  sep: card.chapter_title ? " · " : "",
                  title: card.chapter_title ?? "",
                })}
              </div>
            )}
            <div className="text-lg md:text-xl leading-relaxed">
              {renderMarkdown(card.question)}
            </div>
          </section>

          {showHint && card.hint && !showAnswer && (
            <section className="card p-4 md:p-5 border-amber-500/40 bg-amber-500/5">
              <div className="text-[11px] uppercase tracking-wide text-amber-400 mb-2">
                {t("cards.hintChip")}
              </div>
              <div className="text-sm md:text-base leading-relaxed text-neutral-200">
                {renderMarkdown(card.hint)}
              </div>
            </section>
          )}

          {showAnswer ? (
            <section className="card p-6 md:p-8 border-accent-subtle bg-accent/5">
              <div className="text-[11px] uppercase tracking-wide text-accent mb-3">
                {t("review.solution")}
              </div>
              {card.answer ? (
                <div className="text-base md:text-lg leading-relaxed text-neutral-100">
                  {renderMarkdown(card.answer)}
                </div>
              ) : (
                <p className="text-sm text-neutral-500 italic">{t("review.noSolution")}</p>
              )}
            </section>
          ) : (
            <div className="flex gap-3">
              {card.hint && !showHint && (
                <Button
                  variant="ghost"
                  onClick={() => setShowHint(true)}
                  className="flex-1 py-3 !text-amber-400"
                >
                  💡 {t("review.revealHint")}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setShowAnswer(true)}
                className="flex-1 py-3"
              >
                {t("review.reveal")}
              </Button>
            </div>
          )}

          {showAnswer && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <RateButton
                  label={t("review.forgot")}
                  hint="1"
                  accent="text-accent"
                  onClick={() => rate(1)}
                  disabled={saving}
                />
                <RateButton
                  label={t("review.partial")}
                  hint="2"
                  accent="text-amber-400"
                  onClick={() => rate(3)}
                  disabled={saving}
                />
                <RateButton
                  label={t("review.known")}
                  hint="3"
                  accent="text-emerald-400"
                  onClick={() => rate(5)}
                  disabled={saving}
                />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function RateButton({
  label,
  hint,
  accent,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  accent: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "card card-hover p-4 text-center transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed"
      )}
    >
      <div className={cn("text-sm font-medium", accent)}>{label}</div>
      <div className="text-[10px] text-neutral-500 mt-1 font-mono">
        {t("review.key", { k: hint })}
      </div>
    </button>
  );
}

function Summary({ history, onClose }: { history: SessionEntry[]; onClose: () => void }) {
  const known = history.filter((h) => h.quality === 5).length;
  const partial = history.filter((h) => h.quality === 3).length;
  const forgot = history.filter((h) => h.quality === 1).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 grid place-items-center p-6">
      <div className="card p-8 max-w-lg w-full text-center">
        <div className="text-3xl mb-3">🎯</div>
        <h2 className="text-xl font-semibold mb-6">{t("review.summaryTitle")}</h2>
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="card p-4">
            <div className="text-2xl font-semibold text-emerald-400">{known}</div>
            <div className="text-xs text-neutral-500 mt-1">{t("review.summary.known")}</div>
          </div>
          <div className="card p-4">
            <div className="text-2xl font-semibold text-amber-400">{partial}</div>
            <div className="text-xs text-neutral-500 mt-1">{t("review.summary.partial")}</div>
          </div>
          <div className="card p-4">
            <div className="text-2xl font-semibold text-accent">{forgot}</div>
            <div className="text-xs text-neutral-500 mt-1">{t("review.summary.forgot")}</div>
          </div>
        </div>
        <Button onClick={onClose} className="w-full">
          {t("review.summary.back")}
        </Button>
      </div>
    </div>
  );
}
