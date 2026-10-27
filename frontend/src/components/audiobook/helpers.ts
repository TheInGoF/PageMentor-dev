// Hilfsfunktionen und Konstanten des Hörbuch-Tabs
import type { ChapterAudioStatus, ProgressEvent, Voice } from "../../lib/api";
import { t } from "../../lib/i18n";

// Tempo in 5-%-Schritten von -10 bis +30, Label direkt erzeugt
export const RATE_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const steps: Array<{ value: string; label: string }> = [];
  for (let pct = -10; pct <= 30; pct += 5) {
    if (pct === 0) {
      steps.push({ value: "+0%", label: "Normal" });
    } else if (pct > 0) {
      steps.push({ value: `+${pct}%`, label: `+${pct} %` });
    } else {
      steps.push({ value: `${pct}%`, label: `−${Math.abs(pct)} %` });
    }
  }
  return steps;
})();

// Stimmen sortieren: Flagship zuerst, dann alphabetisch
export function compareVoices(a: Voice, b: Voice): number {
  if (!!a.flagship !== !!b.flagship) return a.flagship ? -1 : 1;
  return a.label.localeCompare(b.label);
}

// Standard pro Kapitelart, synchron mit defaultIncludeForKind() im Backend
export function defaultIncludeFor(kind: string): boolean {
  return kind === "content" || kind === "summary";
}
export function isChapterIncluded(c: ChapterAudioStatus): boolean {
  if (c.include_in_audio == null) return defaultIncludeFor(c.kind);
  return c.include_in_audio === 1;
}


export function describePhase(ev: ProgressEvent): string {
  switch (ev.phase) {
    case "pipeline.extract":
      return t("phase.pipeline.extract");
    case "pipeline.chapters":
      return ev.message ?? t("phase.pipeline.chapters");
    case "pipeline.done":
      return t("phase.pipeline.done");
    case "pipeline.failed":
      return t("phase.pipeline.failed", { msg: ev.message ?? "" });
    case "audiobook.start":
      return ev.message ?? t("phase.audiobook.start", { total: ev.total ?? 0 });
    case "audiobook.chapter.preprocess":
      return t("phase.audiobook.chapter.preprocess", {
        current: ev.current ?? 0,
        total: ev.total ?? 0,
      });
    case "audiobook.chapter.start":
      return t("phase.audiobook.chapter.start", {
        current: ev.current ?? 0,
        total: ev.total ?? 0,
        msg: ev.message ?? "",
      });
    case "audiobook.chapter.progress":
      return t("phase.audiobook.chapter.progress", {
        num: ev.chapterNumber ?? 0,
        current: ev.current ?? 0,
        total: ev.total ?? 0,
      });
    case "audiobook.chapter.done":
      return t("phase.audiobook.chapter.done", {
        current: ev.current ?? 0,
        total: ev.total ?? 0,
      });
    case "audiobook.chapter.failed":
      return t("phase.audiobook.chapter.failed", {
        num: ev.chapterNumber ?? 0,
        msg: ev.message ?? "",
      });
    case "audiobook.book.building":
      return t("phase.audiobook.book.building");
    case "audiobook.done":
      return t("phase.audiobook.done");
    case "audiobook.failed":
      return t("phase.audiobook.failed", { msg: ev.message ?? "" });
    default:
      return ev.message ?? "";
  }
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm >= 60) {
    const hh = Math.floor(mm / 60);
    return `${hh}:${String(mm % 60).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
