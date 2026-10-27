// Modul → Üben: Aufgabentrainer, Lernkarten und Probeklausuren an einem Ort
import { useEffect, useState } from "react";
import { api, type ModuleDetail as ModuleDetailData, type Trainer } from "../../lib/api";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { CardsPanel, ExamsPanel } from "./ModulePanels";
import { TrainerPanel } from "../practice/TrainerPanel";

type Part = "trainer" | "cards" | "exams";

export function PracticePanel({ data, onStartReview, onOpenDocument }: { data: ModuleDetailData; onStartReview: () => void; onOpenDocument: (id: string) => void }) {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [part, setPart] = useState<Part>("cards");
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    void api.study.trainers(data.module.id).then((r) => {
      const list = r.trainers.filter((x) => x.enabled);
      setTrainers(list);
      if (list.length) {
        setPart("trainer");
        setActive(list[0].id);
      }
    });
  }, [data.module.id]);

  const parts: Part[] = trainers.length ? ["trainer", "cards", "exams"] : ["cards", "exams"];
  const trainer = trainers.find((x) => x.id === active);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {parts.map((p) => (
          <button key={p} type="button" className={cn("chip", part === p && "chip-active")} onClick={() => setPart(p)}>
            {t(`practice.${p}`)}
          </button>
        ))}
        {part === "trainer" && trainers.length > 1 && (
          <select className="input !w-auto ml-auto" value={active ?? ""} onChange={(e) => setActive(e.target.value)}>
            {trainers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {part === "trainer" && trainer && <TrainerPanel key={trainer.id} trainer={trainer} moduleId={data.module.id} docs={data.documents} onOpenDocument={onOpenDocument} />}
      {part === "cards" && <CardsPanel data={data} onStart={onStartReview} />}
      {part === "exams" && <ExamsPanel exams={data.exams} />}
    </div>
  );
}
