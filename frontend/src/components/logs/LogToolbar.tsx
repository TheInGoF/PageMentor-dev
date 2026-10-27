// Filterleiste: Quelle, Stufe, Bereich, Suche, Dokument, Job
import { t } from "../../lib/i18n";
import type { LogLevel } from "../../lib/api";
import type { LogFilter } from "./model";

const SOURCES = ["pm-app", "qwen-tts", "arbiter", "ollama", "docling", "system"];
const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

interface Props {
  filter: LogFilter;
  areas: string[];
  onChange: (f: LogFilter) => void;
}

export function LogToolbar({ filter, areas, onChange }: Props) {
  const set = (patch: Partial<LogFilter>) => onChange({ ...filter, ...patch });
  function toggleSource(src: string) {
    const next = new Set(filter.hiddenSources);
    if (next.has(src)) next.delete(src);
    else next.add(src);
    set({ hiddenSources: next });
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          className="input !py-1 !text-xs w-auto"
          value={filter.level}
          onChange={(e) => set({ level: e.target.value as LogLevel })}
          title={t("logs.level")}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {t("logs.levelFrom", { level: l })}
            </option>
          ))}
        </select>
        <select
          className="input !py-1 !text-xs w-auto"
          value={filter.area}
          onChange={(e) => set({ area: e.target.value })}
          title={t("logs.area")}
        >
          <option value="">{t("logs.allAreas")}</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          className="input !py-1 !text-xs flex-1 min-w-[160px]"
          placeholder={t("logs.search")}
          value={filter.q}
          onChange={(e) => set({ q: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-neutral-500">{t("logs.filter")}:</span>
        {SOURCES.map((src) => {
          const active = !filter.hiddenSources.has(src);
          return (
            <button
              key={src}
              type="button"
              onClick={() => toggleSource(src)}
              className={
                "px-2 py-0.5 rounded font-mono transition-colors " +
                (active
                  ? "bg-accent/15 text-accent border border-accent-subtle"
                  : "bg-bg-elevated text-neutral-500 border border-border line-through")
              }
            >
              {src}
            </button>
          );
        })}
        {filter.docId && (
          <Chip label={`docId=${filter.docId}`} onClear={() => set({ docId: "" })} />
        )}
        {filter.jobId && (
          <Chip label={`jobId=${filter.jobId}`} onClear={() => set({ jobId: "" })} />
        )}
      </div>
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="px-2 py-0.5 rounded font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30"
      title={t("logs.removeFilter")}
    >
      {label} ✕
    </button>
  );
}
