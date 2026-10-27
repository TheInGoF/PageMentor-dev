// Material per KI erzeugen: je Dokument ein Knopf, Fortschritt live, danach neu laden
import { useEffect, useState } from "react";
import { api, subscribeProgress, type ModuleDocument } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

function DocRow({ doc, onDone }: { doc: ModuleDocument; onDone: () => void }) {
  const [state, setState] = useState<{ cur: number; total: number } | null>(null);
  const toast = useToast();

  useEffect(() => {
    return subscribeProgress(doc.id, (ev) => {
      if (ev.phase === "material.start") setState({ cur: 0, total: ev.total ?? 1 });
      if (ev.phase === "material.progress") setState({ cur: ev.current ?? 0, total: ev.total ?? 1 });
      if (ev.phase === "material.done") {
        setState(null);
        toast.show(`${doc.title}: ${ev.message ?? ""}`, "success");
        onDone();
      }
      if (ev.phase === "material.failed") {
        setState(null);
        toast.show(ev.message ?? t("common.error"), "error");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  async function start() {
    try {
      await api.study.extract(doc.id);
      setState({ cur: 0, total: 1 });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  return (
    <li className="flex items-center gap-3 py-2 border-t border-border first:border-t-0">
      <span className="flex-1 min-w-0 truncate text-sm">{doc.title}</span>
      <span className="text-xs text-neutral-500">{t(`type.${doc.type}`)}</span>
      {state ? (
        <span className="text-xs tabular-nums text-accent w-28 text-right">
          {t("material.running")} {state.cur}/{state.total}
        </span>
      ) : (
        <Button variant="outline" className="!px-2 !py-1 text-xs w-28" onClick={start} disabled={doc.ocr_status !== "done"}>
          {t("material.extract")}
        </Button>
      )}
    </li>
  );
}

export function MaterialExtract({ moduleId, docs, tasks, onDone }: { moduleId: string; docs: ModuleDocument[]; tasks: number; onDone: () => void }) {
  const toast = useToast();
  async function recipes() {
    try {
      await api.study.recipes(moduleId);
      toast.show(t("material.recipesStarted"), "success");
      setTimeout(onDone, 4000);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }
  return (
    <details className="card p-4 print:hidden">
      <summary className="cursor-pointer text-sm font-medium">{t("material.generate")}</summary>
      <p className="text-xs text-neutral-500 mt-2">{t("material.generateHint")}</p>
      <ul className="mt-2">
        {docs.map((d) => (
          <DocRow key={d.id} doc={d} onDone={onDone} />
        ))}
      </ul>
      {tasks > 0 && (
        <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
          <span className="flex-1 text-sm">{t("material.recipesHint", { n: tasks })}</span>
          <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={recipes}>
            {t("material.recipes")}
          </Button>
        </div>
      )}
    </details>
  );
}
