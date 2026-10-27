// Eine Trainer-Aufgabe: Angabe, dann Lösungsschritte einzeln aufdecken (Kontrakt v2)
import { useState } from "react";
import { BlockMath } from "react-katex";
import type { TrainerRef, TrainerStep, TrainerTask } from "../../lib/trainerHost";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";

function refs(h: TrainerStep["heft"]): TrainerRef[] {
  return Array.isArray(h) ? h : h ? [h] : [];
}

function Step({ step, onOpenRef }: { step: TrainerStep; onOpenRef: (r: TrainerRef) => void }) {
  return (
    <section className="card p-4 flex flex-col gap-3">
      <h4 className="font-semibold">{step.label}</h4>
      {step.warum && <p className="text-sm text-neutral-400">{step.warum}</p>}
      {step.rechnung?.length ? (
        <div className="flex flex-col divide-y divide-border [&_.katex-display]:text-left [&_.katex-display]:my-1">
          {step.rechnung.map((r, i) => (
            <div key={i} className={`grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 items-center py-1 ${r.ergebnis ? "bg-accent/10 rounded-md px-2" : ""}`}>
              <div className="overflow-x-auto">
                <BlockMath math={r.tex} renderError={() => <code className="text-xs">{r.tex}</code>} />
              </div>
              {r.note && <div className="text-xs text-neutral-500">{r.note}</div>}
            </div>
          ))}
        </div>
      ) : (
        step.body && <pre className="text-sm whitespace-pre-wrap font-sans">{step.body}</pre>
      )}
      {step.falle && <div className="rounded-md bg-red-500/10 text-red-600 text-sm px-3 py-2">⚠ {step.falle}</div>}
      {refs(step.heft).map((r, i) => (
        <div key={i} className="rounded-md bg-bg-elevated border border-border text-sm px-3 py-2 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="flex-1 min-w-0">
              📖 {r.heft} · {t("trainer.chapter")} {r.kap}
              {r.titel ? ` ${r.titel}` : ""}
              {r.gl ? ` · ${t("trainer.equation")} ${r.gl}` : ""}
            </span>
            <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => onOpenRef(r)}>
              {t("trainer.openRef")} →
            </Button>
          </div>
          {r.tex && <BlockMath math={r.tex} renderError={() => <code className="text-xs">{r.tex}</code>} />}
          {r.hinweis && <p className="text-xs text-neutral-500">{r.hinweis}</p>}
        </div>
      ))}
    </section>
  );
}

export function TrainerTaskView({ task, onNext, onOpenRef }: { task: TrainerTask; onNext: () => void; onOpenRef: (r: TrainerRef) => void }) {
  const [shown, setShown] = useState(0);
  const all = shown >= task.steps.length;
  return (
    <div className="flex flex-col gap-3">
      <div className="card p-4">
        <h3 className="font-semibold mb-2">{task.title}</h3>
        <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{task.prompt}</pre>
      </div>
      {task.steps.slice(0, shown).map((s, i) => (
        <Step key={i} step={s} onOpenRef={onOpenRef} />
      ))}
      <div className="flex flex-wrap gap-2">
        {!all && <Button onClick={() => setShown(shown + 1)}>{shown === 0 ? t("trainer.firstStep") : t("trainer.nextStep")} ({shown + 1}/{task.steps.length})</Button>}
        {!all && (
          <Button variant="ghost" onClick={() => setShown(task.steps.length)}>
            {t("trainer.showAll")}
          </Button>
        )}
        <Button variant={all ? "primary" : "outline"} onClick={onNext}>
          {t("trainer.newTask")}
        </Button>
      </div>
    </div>
  );
}
