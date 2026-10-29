// Modul → Lernen: Hefte, Zusammenfassungen, Material und Zusammenhänge an einem Ort
import { useState } from "react";
import type { ModuleDetail as ModuleDetailData } from "../../lib/api";
import type { LearnPart } from "../../lib/moduleTab";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Documents, SummariesPanel } from "./ModulePanels";
import { MaterialPanel } from "./MaterialPanel";
import { GraphPanel } from "./GraphPanel";
import { HeftSelect } from "./HeftSelect";
import { Summaries } from "../Summaries";

const PARTS: LearnPart[] = ["docs", "summaries", "material", "graph"];

export function LearnPanel({
  data,
  initial,
  initialDoc,
  onOpenDocument,
}: {
  data: ModuleDetailData;
  initial?: LearnPart;
  initialDoc?: string;
  onOpenDocument: (id: string) => void;
}) {
  const [part, setPart] = useState<LearnPart>(initial ?? "docs");
  const [docId, setDocId] = useState(initialDoc ?? "");
  const ready = data.documents.filter((d) => d.chapter_count > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {PARTS.map((p) => (
          <button key={p} type="button" className={cn("chip", part === p && "chip-active")} onClick={() => setPart(p)}>
            {t(`module.learn.${p}`)}
          </button>
        ))}
        {part === "summaries" && ready.length > 0 && (
          <div className="ml-auto">
            <HeftSelect docs={ready} value={docId} onChange={setDocId} />
          </div>
        )}
      </div>
      {part === "docs" && <Documents data={data} onOpen={onOpenDocument} />}
      {part === "summaries" && (docId ? <Summaries key={docId} docId={docId} /> : <SummariesPanel summaries={data.summaries} />)}
      {part === "material" && <MaterialPanel moduleId={data.module.id} moduleName={data.module.name} docs={data.documents} onOpenDocument={onOpenDocument} />}
      {part === "graph" && <GraphPanel moduleId={data.module.id} onOpenDocument={onOpenDocument} />}
    </div>
  );
}
