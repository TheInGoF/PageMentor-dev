// Bereich Plan: Kennzahlen, Leistungen nach Monaten, Fortschritt; druckbar als PDF
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Assessment, type ExamSlot, type ModuleListItem, type StudyProgress } from "../../lib/api";
import { t, useLocale } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { TopBar } from "../TopBar";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { AssessmentRow, formatDate } from "./AssessmentRow";
import { AssessmentModal } from "./AssessmentModal";
import { ProgressView } from "./ProgressView";

const DONE = new Set(["bestanden", "nicht_bestanden", "abgemeldet"]);
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export function PlanPage({ onOpenModule, onOpenDocument, onOpenSettings }: { onOpenModule: (id: string) => void; onOpenDocument: (id: string) => void; onOpenSettings: () => void }) {
  useLocale();
  const toast = useToast();
  const [progress, setProgress] = useState<StudyProgress | null>(null);
  const [items, setItems] = useState<Assessment[]>([]);
  const [slots, setSlots] = useState<ExamSlot[]>([]);
  const [modules, setModules] = useState<ModuleListItem[]>([]);
  const [part, setPart] = useState<"plan" | "progress">("plan");
  const [showBooklets, setShowBooklets] = useState(false);
  const [editing, setEditing] = useState<Assessment | null | undefined>(undefined);

  const load = useCallback(async () => {
    const [p, l, s, m] = await Promise.all([api.plan.progress(), api.plan.list(), api.plan.slots(), api.modules.list()]);
    setProgress(p);
    setItems(l.assessments);
    setSlots(s.slots);
    setModules(m);
  }, []);
  useEffect(() => {
    void load().catch((err) => toast.show(err instanceof Error ? err.message : t("common.error"), "error"));
  }, [load, toast]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  };

  const visible = items.filter((a) => showBooklets || a.kind !== "H");
  const open = visible.filter((a) => !DONE.has(a.status));
  const done = visible.filter((a) => DONE.has(a.status)).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const months = useMemo(() => {
    const map = new Map<string, Assessment[]>();
    for (const a of open) {
      const key = a.date ? a.date.slice(0, 7) : "";
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return [...map.entries()].sort(([a], [b]) => (a || "9999").localeCompare(b || "9999"));
  }, [open]);
  const slotOf = (d: string | null) => slots.find((s) => s.date === d);
  const mod = (id: string | null) => modules.find((m) => m.id === id);

  async function status(a: Assessment, s: Assessment["status"]) {
    await run(() => api.plan.update(a.id, { status: s }));
    if (s === "nicht_bestanden" && confirm(t("plan.retryConfirm", { title: a.title, n: a.attempt + 1 }))) await run(() => api.plan.retry(a.id));
  }

  async function shift(a: Assessment) {
    try {
      const p = await api.plan.shift(a.id, false);
      const text = p.steps.map((s) => `• ${s.title}: ${s.from} → ${s.to}${s.estimate ? " (TBA)" : ""}`).join("\n");
      const warn = p.warnings.length ? `\n\n⚠ ${p.warnings.join("\n⚠ ")}` : "";
      if (confirm(`${t("plan.shiftConfirm")}\n\n${text}${warn}`)) await run(() => api.plan.shift(a.id, true));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  const row = (a: Assessment) => (
    <AssessmentRow
      key={a.id}
      a={a}
      module={mod(a.module_id)}
      slot={slotOf(a.date)}
      onStatus={(s) => void status(a, s)}
      onGrade={(g) => void run(() => api.plan.update(a.id, { grade: g }))}
      onShift={() => void shift(a)}
      onEdit={() => setEditing(a)}
      onOpenModule={onOpenModule}
    />
  );

  const next = progress?.nextExam;
  return (
    <div className="min-h-full flex flex-col">
      <TopBar onOpenDocument={onOpenDocument} onOpenSettings={onOpenSettings} />
      <main className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        {progress && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card p-4">
              <div className="text-xs text-neutral-500">{t("plan.cp")}</div>
              <div className="text-2xl font-semibold tabular-nums mt-1">
                {progress.earnedCp}
                {progress.totalCp ? <span className="text-sm text-neutral-500"> / {progress.totalCp}</span> : null}
              </div>
              {progress.totalCp ? (
                <div className="h-1.5 mt-2 rounded-full bg-bg-elevated overflow-hidden">
                  <div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(100, (progress.earnedCp / progress.totalCp) * 100)}%` }} />
                </div>
              ) : null}
            </div>
            <div className="card p-4">
              <div className="text-xs text-neutral-500">{t("plan.average")}</div>
              <div className="text-2xl font-semibold tabular-nums mt-1">{progress.average != null ? progress.average.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "–"}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-neutral-500">{t("plan.modulesDone")}</div>
              <div className="text-2xl font-semibold tabular-nums mt-1">
                {progress.passedModules}
                <span className="text-sm text-neutral-500"> · {t("plan.modulesOpen", { n: progress.openModules })}</span>
              </div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-neutral-500">{t("plan.nextExam")}</div>
              <div className="text-2xl font-semibold tabular-nums mt-1">{next ? t("plan.inDays", { n: next.days }) : "–"}</div>
              {next && <div className="text-xs text-neutral-500 truncate">{next.module_code ?? next.title} · {formatDate(next.date)}</div>}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button type="button" className={cn("chip", part === "plan" && "chip-active")} onClick={() => setPart("plan")}>
            {t("plan.tab.plan")}
          </button>
          <button type="button" className={cn("chip", part === "progress" && "chip-active")} onClick={() => setPart("progress")}>
            {t("plan.tab.progress")}
          </button>
          {part === "plan" && (
            <label className="text-xs text-neutral-500 flex items-center gap-1.5 ml-2">
              <input type="checkbox" checked={showBooklets} onChange={(e) => setShowBooklets(e.target.checked)} />
              {t("plan.showBooklets")}
            </label>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              {t("plan.print")}
            </Button>
            {part === "plan" && <Button onClick={() => setEditing(null)}>+ {t("plan.add")}</Button>}
          </div>
        </div>

        {part === "progress" ? (
          <ProgressView modules={modules} />
        ) : (
          <div className="print-area flex flex-col gap-4">
            <h2 className="hidden print:block text-xl font-semibold">{t("plan.printTitle", { date: new Date().toLocaleDateString() })}</h2>
            {!visible.length && <div className="card p-8 text-center text-sm text-neutral-500">{t("plan.empty")}</div>}
            {months.map(([ym, list]) => (
              <section key={ym || "none"} className="card p-4 break-inside-avoid">
                <h3 className="text-sm font-semibold mb-1">{ym ? monthLabel(ym) : t("plan.noDate")}</h3>
                <ul>{list.map(row)}</ul>
              </section>
            ))}
            {done.length > 0 && (
              <details className="card p-4" open={false}>
                <summary className="cursor-pointer text-sm font-semibold">{t("plan.done", { n: done.length })}</summary>
                <ul className="mt-2">{done.map(row)}</ul>
              </details>
            )}
          </div>
        )}
      </main>

      <AssessmentModal
        open={editing !== undefined}
        editing={editing ?? null}
        modules={modules}
        slots={slots}
        onClose={() => setEditing(undefined)}
        onSave={async (a) => {
          await run(() => (editing ? api.plan.update(editing.id, a) : api.plan.create(a)));
          setEditing(undefined);
        }}
        onDelete={async (id) => {
          await run(() => api.plan.remove(id));
          setEditing(undefined);
        }}
      />
    </div>
  );
}
