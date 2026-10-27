// Aufgabentrainer eines Moduls: Generator wählen, Zufalls- oder Klausurwerte, Schritte aufdecken
import { useEffect, useMemo, useState } from "react";
import { api, type ModuleDocument, type Trainer, type TrainerCheck } from "../../lib/api";
import { TrainerHost, type GeneratorInfo, type TrainerRef, type TrainerTask } from "../../lib/trainerHost";
import { useStudyTimer } from "../../lib/useStudyTimer";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { TrainerTaskView } from "./TrainerTaskView";

export function TrainerPanel({ trainer, moduleId, docs, onOpenDocument }: { trainer: Trainer; moduleId: string; docs: ModuleDocument[]; onOpenDocument: (id: string) => void }) {
  const [host, setHost] = useState<TrainerHost | null>(null);
  const [gens, setGens] = useState<GeneratorInfo[]>([]);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [gen, setGen] = useState<string | null>(null);
  const [task, setTask] = useState<{ key: number; data: TrainerTask } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<TrainerCheck | null>(null);
  const toast = useToast();
  useStudyTimer(moduleId, "trainer", !!task);

  useEffect(() => {
    let h: TrainerHost | null = null;
    let alive = true;
    api.study
      .trainerSource(trainer.id)
      .then(async (src) => {
        h = new TrainerHost(src, trainer.global_name ?? "", trainer.colors_name);
        const r = await h.list();
        if (!alive) return;
        setHost(h);
        setGens(r.generators);
        setColors(r.colors);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
      h?.dispose();
    };
  }, [trainer]);

  const topics = useMemo(() => [...new Set(gens.map((g) => g.topic))], [gens]);
  const current = gens.find((g) => g.id === gen);

  async function load(id: string, klausur?: number) {
    if (!host) return;
    setGen(id);
    try {
      setTask({ key: Date.now(), data: await host.task(id, klausur) });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  // Heft-Verweis: Dokument mit passendem Heftcode oder Kürzel öffnen
  function openRef(r: TrainerRef) {
    const code = (r.heft ?? "").toUpperCase();
    const doc = docs.find((d) => (d.heft_code ?? "").toUpperCase() === code || (d.short_code ?? "").toUpperCase() === code);
    if (doc) onOpenDocument(doc.id);
    else toast.show(t("trainer.refMissing", { heft: r.heft ?? "?" }), "error");
  }

  if (error) return <div className="card p-4 text-sm text-red-600">{error}</div>;
  if (!host) return <div className="text-sm text-neutral-500">{t("common.loading")}</div>;

  return (
    <div className="flex flex-col gap-4">
      {topics.map((topic) => (
        <div key={topic} className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-neutral-500 w-full sm:w-28">{topic}</span>
          {gens
            .filter((g) => g.topic === topic)
            .map((g) => (
              <button key={g.id} type="button" onClick={() => load(g.id)} className={cn("chip", gen === g.id && "chip-active")} style={colors[topic] ? { borderLeft: `4px solid ${colors[topic]}` } : undefined}>
                {g.name}
              </button>
            ))}
        </div>
      ))}

      {current && current.klausur.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-500">{t("trainer.examValues")}:</span>
          {current.klausur.map((q, i) => (
            <button key={i} type="button" className="chip" onClick={() => load(current.id, i)}>
              {q}
            </button>
          ))}
        </div>
      )}

      {task ? (
        <TrainerTaskView key={task.key} task={task.data} onNext={() => gen && load(gen)} onOpenRef={openRef} />
      ) : (
        <div className="card p-6 text-sm text-neutral-500 text-center">{t("trainer.pick")}</div>
      )}

      <div className="text-xs text-neutral-500 flex items-center gap-2">
        <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={async () => setCheck(await api.study.trainerCheck(trainer.id))}>
          {t("trainer.selfTest")}
        </Button>
        {check &&
          (check.ok ? (
            <span className="text-green-600">✓ {t("trainer.selfTestOk", { gens: check.generators, runs: check.runs })}</span>
          ) : (
            <span className="text-red-600" title={check.problems.join("\n")}>
              ⚠ {check.problems.length} · {check.problems[0]}
            </span>
          ))}
      </div>
    </div>
  );
}
