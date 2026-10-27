// Kapitelarten gesammelt an- und abwählen
import { useMemo } from "react";
import type { ChapterAudioStatus } from "../../lib/api";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";


const KIND_FILTERS: Array<{ kind: string; defaultOn: boolean }> = [
  { kind: "content", defaultOn: true },
  { kind: "summary", defaultOn: true },
  { kind: "example", defaultOn: false },
  { kind: "exercise", defaultOn: false },
  { kind: "self_check", defaultOn: false },
  { kind: "solutions", defaultOn: false },
  { kind: "index", defaultOn: false },
  { kind: "references", defaultOn: false },
  { kind: "meta", defaultOn: false },
];

export function KindFilterBar({
  chapters,
  busy,
  onToggle,
}: {
  chapters: ChapterAudioStatus[];
  busy: string | null;
  onToggle: (kind: string, include: boolean) => void;
}) {
  // Pro Art: Anzahl und davon gewählt
  const stats = useMemo(() => {
    const m = new Map<string, { total: number; included: number }>();
    for (const c of chapters) {
      const cur = m.get(c.kind) ?? { total: 0, included: 0 };
      cur.total++;
      const isIncluded =
        c.include_in_audio == null
          ? c.kind === "content" || c.kind === "summary"
          : c.include_in_audio === 1;
      if (isIncluded) cur.included++;
      m.set(c.kind, cur);
    }
    return m;
  }, [chapters]);

  // Nur Arten zeigen, die im Dokument vorkommen
  const visible = KIND_FILTERS.filter((f) => stats.has(f.kind));
  if (visible.length === 0) return null;

  return (
    <section className="card p-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold">
          {t("audiobook.kindFilter.title")}
        </h3>
        <span className="text-xs text-neutral-500">
          {t("audiobook.kindFilter.hint")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map(({ kind }) => {
          const s = stats.get(kind)!;
          const allOn = s.included === s.total;
          const allOff = s.included === 0;
          const label = t(`chapters.kind.${kind}`);
          return (
            <div
              key={kind}
              className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-bg-elevated"
            >
              <span className="text-xs text-neutral-300">
                {label}{" "}
                <span className="text-neutral-500">
                  ({s.included}/{s.total})
                </span>
              </span>
              <button
                type="button"
                onClick={() => onToggle(kind, true)}
                disabled={busy != null || allOn}
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded ml-1",
                  allOn
                    ? "bg-emerald-700/40 text-emerald-200 cursor-default"
                    : "bg-neutral-700 text-neutral-200 hover:bg-emerald-700/30"
                )}
                title={t("audiobook.kindFilter.allOn")}
              >
                {busy === kind ? "…" : t("common.yes")}
              </button>
              <button
                type="button"
                onClick={() => onToggle(kind, false)}
                disabled={busy != null || allOff}
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded",
                  allOff
                    ? "bg-red-700/40 text-red-200 cursor-default"
                    : "bg-neutral-700 text-neutral-200 hover:bg-red-700/30"
                )}
                title={t("audiobook.kindFilter.allOff")}
              >
                {t("common.no")}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
