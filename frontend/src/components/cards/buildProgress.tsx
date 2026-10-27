// Fortschritt der Kartenerzeugung
import {
  type ProgressEvent,
} from "../../lib/api";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";

export interface BuildState {
  active: boolean;
  chapterCurrent: number;
  chapterTotal: number;
  chapterTitle: string | null;
  chunkCurrent: number;
  chunkTotal: number;
  cardsCount: number;
  error: string | null;
  finished: "done" | "failed" | "canceled" | null;
}

export const INITIAL_BUILD: BuildState = {
  active: false,
  chapterCurrent: 0,
  chapterTotal: 0,
  chapterTitle: null,
  chunkCurrent: 0,
  chunkTotal: 0,
  cardsCount: 0,
  error: null,
  finished: null,
};


export function reduceBuild(prev: BuildState, ev: ProgressEvent): BuildState {
  switch (ev.phase) {
    case "cards.start":
      return {
        ...INITIAL_BUILD,
        active: true,
        chapterTotal: ev.total ?? 0,
      };
    case "cards.chapter":
      return {
        ...prev,
        active: true,
        chapterCurrent: (ev.current ?? 0) + 1,
        chapterTotal: ev.total ?? prev.chapterTotal,
        chapterTitle: ev.message ?? null,
        chunkCurrent: 0,
        chunkTotal: 0,
      };
    case "cards.chunk":
      return {
        ...prev,
        active: true,
        chunkCurrent: ev.current ?? 0,
        chunkTotal: ev.total ?? 0,
      };
    case "cards.progress":
      return {
        ...prev,
        active: true,
        cardsCount: ev.current ?? prev.cardsCount,
      };
    case "cards.done":
      return {
        ...prev,
        active: false,
        chapterCurrent: prev.chapterTotal,
        chunkCurrent: prev.chunkTotal,
        cardsCount: ev.current ?? prev.cardsCount,
        finished: "done",
      };
    case "cards.canceled":
      return { ...prev, active: false, finished: "canceled" };
    case "cards.failed":
      return {
        ...prev,
        active: false,
        finished: "failed",
        error: ev.message ?? "unknown",
      };
    default:
      return prev;
  }
}

export function BuildProgressPanel({ state }: { state: BuildState }) {
  const chapterPct =
    state.chapterTotal > 0
      ? Math.round(((state.chapterCurrent - 1) / state.chapterTotal) * 100)
      : 0;
  const chunkPct =
    state.chunkTotal > 0
      ? Math.round((state.chunkCurrent / state.chunkTotal) * 100)
      : 0;

  return (
    <div
      className={cn(
        "border rounded-md p-3 flex flex-col gap-2 text-xs font-mono",
        state.finished === "failed"
          ? "border-accent-subtle bg-accent/5"
          : state.finished === "canceled"
            ? "border-border bg-bg-elevated"
            : "border-accent-subtle bg-accent/5"
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "uppercase tracking-wide",
            state.finished === "failed" ? "text-accent" : "text-accent"
          )}
        >
          {state.finished === "done"
            ? t("cards.build.donePhase")
            : state.finished === "failed"
              ? t("cards.build.failedPhase")
              : state.finished === "canceled"
                ? t("cards.build.canceledPhase")
                : t("cards.build.runningPhase")}
        </span>
        <span className="text-neutral-500">
          {t("cards.build.cardsSoFar", { n: state.cardsCount })}
        </span>
      </div>

      {state.chapterTotal > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-neutral-400 truncate">
              {t("cards.build.chapterLabel", {
                current: Math.max(1, state.chapterCurrent),
                total: state.chapterTotal,
              })}
              {state.chapterTitle ? ` — ${state.chapterTitle}` : ""}
            </span>
            <span className="text-neutral-500 shrink-0">{chapterPct}%</span>
          </div>
          <div className="h-1 bg-black/40 rounded overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${chapterPct}%` }}
            />
          </div>
        </div>
      )}

      {state.chunkTotal > 0 && state.active && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-neutral-500">
              {t("cards.build.chunkLabel", {
                current: state.chunkCurrent,
                total: state.chunkTotal,
              })}
            </span>
            <span className="text-neutral-500 shrink-0">{chunkPct}%</span>
          </div>
          <div className="h-1 bg-black/40 rounded overflow-hidden">
            <div
              className="h-full bg-accent/60 transition-all"
              style={{ width: `${chunkPct}%` }}
            />
          </div>
        </div>
      )}

      {state.error && (
        <p className="text-accent text-xs mt-1 break-words">{state.error}</p>
      )}
    </div>
  );
}
