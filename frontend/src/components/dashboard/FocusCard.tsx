// Startseite: nächste Prüfung mit Countdown und was bis dahin noch offen ist
import { useEffect, useState } from "react";
import { api, type ExamFocus } from "../../lib/api";
import { t } from "../../lib/i18n";
import { openModuleAt, type ModuleTab } from "../../lib/moduleTab";

const TARGET: Record<ExamFocus["todo"][number]["key"], ModuleTab> = {
  uncertain: "material",
  noMaterial: "material",
  dueCards: "cards",
  trainer: "trainer",
  noTime: "practice",
};

export function FocusCard({ onOpenModule }: { onOpenModule: (id: string) => void }) {
  const [f, setF] = useState<ExamFocus | null>(null);
  useEffect(() => {
    void api.plan.focus().then(setF).catch(() => undefined);
  }, []);
  if (!f?.exam) return null;
  const { exam } = f;
  const open = (tab: ModuleTab) => exam.moduleId && openModuleAt(exam.moduleId, tab, onOpenModule);

  return (
    <section className="card p-5 flex flex-col sm:flex-row gap-5">
      <div className="sm:w-48 shrink-0">
        <div className="text-xs text-neutral-500">{t("focus.nextExam")}</div>
        <div className="text-2xl font-semibold tabular-nums mt-1 whitespace-nowrap">{t("plan.inDays", { n: exam.days })}</div>
        <div className="text-sm mt-1 truncate">{exam.moduleCode ?? exam.title}</div>
        <div className="text-xs text-neutral-500">{exam.date.split("-").reverse().join(".")}</div>
      </div>
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="text-xs text-neutral-500">{t("focus.todo")}</div>
        {f.todo.length === 0 && <div className="text-sm text-green-600">✓ {t("focus.allDone")}</div>}
        {f.todo.map((item) => (
          <button key={item.key} type="button" onClick={() => open(TARGET[item.key])} className="text-left text-sm rounded-md px-3 py-2 bg-bg-elevated hover:bg-bg-hover flex items-center gap-2">
            <span className="flex-1">{t(`focus.${item.key}`, { n: item.count })}</span>
            <span className="text-accent">→</span>
          </button>
        ))}
        <div className="text-xs text-neutral-500 mt-1">{t("focus.minutes7", { n: f.minutes7 })}</div>
      </div>
    </section>
  );
}
