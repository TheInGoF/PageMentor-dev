// Modul → Üben: Aufgabentrainer, Lernkarten und Probeklausuren für die Klausur an einem Ort
// Lernkarten und Probeklausuren: „Alle Hefte“ zeigt das Modul, ein Heft das Werkzeug dazu
import { useEffect, useState } from "react";
import { api, type ModuleDetail as ModuleDetailData, type Trainer } from "../../lib/api";
import type { PracticePart } from "../../lib/moduleTab";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { CardsPanel, ExamsPanel } from "./ModulePanels";
import { TrainerPanel } from "../practice/TrainerPanel";
import { HeftSelect } from "./HeftSelect";
import { Cards } from "../Cards";
import { ExamTrainer } from "../ExamTrainer";

export function PracticePanel({
  data,
  initial,
  initialDoc,
  onStartReview,
  onOpenDocument,
}: {
  data: ModuleDetailData;
  initial?: PracticePart;
  initialDoc?: string;
  onStartReview: () => void;
  onOpenDocument: (id: string) => void;
}) {
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [part, setPart] = useState<PracticePart>(initial ?? "cards");
  const [active, setActive] = useState<string | null>(null);
  const [docId, setDocId] = useState(initialDoc ?? "");

  useEffect(() => {
    void api.study.trainers(data.module.id).then((r) => {
      const list = r.trainers.filter((x) => x.enabled);
      setTrainers(list);
      if (list.length) {
        if (!initial) setPart("trainer");
        setActive(list[0].id);
      }
    });
  }, [data.module.id, initial]);

  const parts: PracticePart[] = trainers.length ? ["trainer", "cards", "exams"] : ["cards", "exams"];
  const trainer = trainers.find((x) => x.id === active);
  const ready = data.documents.filter((d) => d.chapter_count > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {parts.map((p) => (
          <button key={p} type="button" className={cn("chip", part === p && "chip-active")} onClick={() => setPart(p)}>
            {t(`practice.${p}`)}
          </button>
        ))}
        <div className="ml-auto">
          {part === "trainer" && trainers.length > 1 && (
            <select className="input !w-auto" value={active ?? ""} onChange={(e) => setActive(e.target.value)}>
              {trainers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
          )}
          {part !== "trainer" && ready.length > 0 && <HeftSelect docs={ready} value={docId} onChange={setDocId} />}
        </div>
      </div>
      {part === "trainer" && trainer && <TrainerPanel key={trainer.id} trainer={trainer} moduleId={data.module.id} docs={data.documents} onOpenDocument={onOpenDocument} />}
      {part === "cards" && (docId ? <Cards key={docId} docId={docId} /> : <CardsPanel data={data} onStart={onStartReview} />)}
      {part === "exams" && (docId ? <ExamTrainer key={docId} docId={docId} /> : <ExamsPanel exams={data.exams} />)}
    </div>
  );
}
