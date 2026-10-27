// Klausur-Trainer: Einstellungen, Lauf, Auswertung, Verlauf
import { useEffect, useState } from "react";
import { api, type ExamSession, type ExamSessionSummary } from "../lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { cn } from "../lib/cn";
import { getSettings } from "../lib/settings";
import { t } from "../lib/i18n";
import { ExamSessionRunner } from "./exam/Runner";
import { ExamReview } from "./exam/Review";
import { History } from "./exam/History";

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
      // In die Auswertung mit den bisherigen Antworten, Nutzer bewertet selbst
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
