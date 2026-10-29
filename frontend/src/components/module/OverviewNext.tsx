// Modul-Übersicht: nächste Schritte statt doppelter Listen; Klick führt in den passenden Reiter
import { useEffect, useState } from "react";
import { api, type MaterialCounts } from "../../lib/api";
import type { ModuleTab } from "../../lib/moduleTab";
import { t } from "../../lib/i18n";

export function OverviewNext({ moduleId, due, docs, onTab }: { moduleId: string; due: number; docs: number; onTab: (tab: ModuleTab) => void }) {
  const [counts, setCounts] = useState<MaterialCounts | null>(null);
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    void api.study.material(moduleId).then((r) => setCounts(r.counts));
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    void api.plan.time(day(6), day(0)).then((r) => setMinutes(r.perModule.find((p) => p.module_id === moduleId)?.minutes ?? 0));
  }, [moduleId]);

  const material = counts ? counts.merksatz + counts.formel + counts.rezept + counts.aufgabe : 0;
  const rows: Array<{ text: string; tab: ModuleTab; hot?: boolean }> = [];
  if (counts?.uncertain) rows.push({ text: t("focus.uncertain", { n: counts.uncertain }), tab: "material", hot: true });
  if (due) rows.push({ text: t("focus.dueCards", { n: due }), tab: "cards", hot: true });
  if (!material && docs) rows.push({ text: t("overview.noMaterial"), tab: "material" });
  if (material) rows.push({ text: t("overview.material", { n: material }), tab: "material" });
  rows.push({ text: t("overview.listen"), tab: "audio" });

  return (
    <section className="card p-5 flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide text-neutral-500">{t("overview.next")}</h3>
      {rows.map((r) => (
        <button key={r.text} type="button" onClick={() => onTab(r.tab)} className="text-left text-sm rounded-md px-3 py-2 bg-bg-elevated hover:bg-bg-hover flex items-center gap-2">
          <span className={`flex-1 ${r.hot ? "text-accent" : ""}`}>{r.text}</span>
          <span className="text-accent">→</span>
        </button>
      ))}
      <p className="text-xs text-neutral-500 mt-1">{t("focus.minutes7", { n: minutes })}</p>
    </section>
  );
}
