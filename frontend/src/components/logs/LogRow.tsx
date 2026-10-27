// Eine Log-Zeile, aufklappbar für Kontext und Fehlerdetails
import { useState } from "react";
import type { LogErrorInfo } from "../../lib/api";
import { t } from "../../lib/i18n";
import { formatTs, levelColor, sourceColor, type UiLogLine } from "./model";

interface Props {
  line: UiLogLine;
  onFilter: (key: "docId" | "jobId" | "area", value: string) => void;
}

export function LogRow({ line, onFilter }: Props) {
  const [open, setOpen] = useState(false);
  const expandable = !!line.err || !!line.ctx;
  return (
    <div className="px-2 hover:bg-bg-elevated/40">
      <div
        className={"flex gap-2 " + (expandable ? "cursor-pointer" : "")}
        onClick={() => expandable && setOpen((o) => !o)}
      >
        <span className="text-neutral-600 shrink-0">{formatTs(line.ts)}</span>
        <span className={"shrink-0 w-16 truncate " + sourceColor(line.source)}>{line.source}</span>
        <button
          type="button"
          className="shrink-0 w-20 truncate text-left font-mono text-xs leading-relaxed text-neutral-400 hover:text-accent"
          onClick={(e) => {
            e.stopPropagation();
            onFilter("area", line.area);
          }}
        >
          {line.area}
        </button>
        <span className={"shrink-0 w-12 " + levelColor(line.level)}>{line.level}</span>
        <span className="text-neutral-200 whitespace-pre-wrap break-all">
          {expandable && <span className="text-neutral-500 mr-1">{open ? "▾" : "▸"}</span>}
          {line.message}
        </span>
      </div>
      {open && (
        <div className="ml-24 my-1 flex flex-col gap-1 text-neutral-400">
          {line.ctx && (
            <div className="flex gap-2 flex-wrap">
              {Object.entries(line.ctx).map(([k, v]) =>
                k === "docId" || k === "jobId" ? (
                  <button
                    key={k}
                    type="button"
                    className="px-1.5 rounded bg-accent/15 text-accent"
                    onClick={() => onFilter(k, String(v))}
                    title={t("logs.filterBy")}
                  >
                    {k}={String(v)}
                  </button>
                ) : (
                  <span key={k} className="px-1.5 rounded bg-bg-elevated">
                    {k}={String(v)}
                  </span>
                )
              )}
            </div>
          )}
          {line.err && <ErrorDetails err={line.err} />}
        </div>
      )}
    </div>
  );
}

function ErrorDetails({ err }: { err: LogErrorInfo }) {
  return (
    <div className="border-l-2 border-red-500/40 pl-2">
      <div className="text-red-300">
        {err.name}: {err.message}
        {err.status ? ` [HTTP ${err.status}]` : ""}
        {err.url ? ` ${err.url}` : ""}
      </div>
      {err.body && <pre className="whitespace-pre-wrap text-neutral-400">{err.body}</pre>}
      {err.stack && <pre className="whitespace-pre-wrap text-neutral-500">{err.stack}</pre>}
      {err.cause && (
        <div className="mt-1">
          <div className="text-neutral-500">{t("logs.cause")}</div>
          <ErrorDetails err={err.cause} />
        </div>
      )}
    </div>
  );
}
