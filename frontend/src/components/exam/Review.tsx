// Auswertung: eigene Antwort neben Lösung, Selbstbewertung
import { useState } from "react";
import { api, type ExamSession, type ReviewQuality } from "../../lib/api";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";

export function ExamReview({
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
