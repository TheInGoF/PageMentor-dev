// Modul-Detail: Dokumente, Karten, Klausuren, Audio, Zusammenfassungen
import { useMemo } from "react";
import {
  api,
  type DocType,
  type ModuleAudioChapter,
  type ModuleDetail as ModuleDetailData,
  type ModuleDocument,
  type ModuleExam,
  type ModuleSummary,
} from "../../lib/api";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";

export function Documents({
  data,
  onOpen,
}: {
  data: ModuleDetailData;
  onOpen: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const order: DocType[] = [
      "studienheft",
      "script",
      "uebung",
      "klausur",
      "literatur",
      "sonstiges",
    ];
    const map = new Map<DocType, ModuleDocument[]>();
    for (const ty of order) map.set(ty, []);
    for (const d of data.documents) {
      map.get(d.type)?.push(d);
    }
    return order
      .map((ty) => ({ type: ty, docs: map.get(ty) ?? [] }))
      .filter((g) => g.docs.length > 0);
  }, [data.documents]);

  if (grouped.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-neutral-500">
        {t("modules.empty.hint")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {grouped.map((g) => (
        <section key={g.type}>
          <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
            {t(`module.docs.${g.type}`)} · {g.docs.length}
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {g.docs.map((d) => (
              <li
                key={d.id}
                onClick={() => onOpen(d.id)}
                className="card card-hover p-4 cursor-pointer"
              >
                <div className="font-medium truncate">{d.title}</div>
                <div className="text-xs text-neutral-500 mt-1">
                  {d.page_count > 0 && `${d.page_count} ${t("library.pagesShort")} · `}
                  {d.chapter_count} {t("learn.tab.chapters").toLowerCase()} ·{" "}
                  {d.audio_done} {t("pipe.audio").toLowerCase()} ·{" "}
                  {d.card_count} {t("pipe.cards").toLowerCase()}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function CardsPanel({
  data,
  onStart,
}: {
  data: ModuleDetailData;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5 flex items-center justify-between flex-wrap gap-3">
        <div className="grid grid-cols-3 gap-4">
          <MiniPill label={t("cards.stats.total")} value={data.cardStats.total} />
          <MiniPill
            label={t("cards.stats.due")}
            value={data.cardStats.due}
            accent={data.cardStats.due > 0}
          />
          <MiniPill label={t("cards.stats.learned")} value={data.cardStats.learned} />
        </div>
        <Button onClick={onStart} disabled={data.cardStats.due === 0}>
          {data.cardStats.due > 0 ? t("module.learn") : t("module.learnNone")}
        </Button>
      </section>
      <p className="text-xs text-neutral-500">
        Karten werden aus allen Dokumenten des Moduls gemischt und nach SM-2
        fälligem Review-Datum gezogen.
      </p>
    </div>
  );
}

export function MiniPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className={cn(
          "text-xl font-semibold",
          accent && value > 0 ? "text-accent" : "text-neutral-100"
        )}
      >
        {value}
      </div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

export function ExamsPanel({ exams }: { exams: ModuleExam[] }) {
  if (exams.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-neutral-500">
        {t("module.exams.empty")}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {exams.map((e) => (
        <li
          key={e.id}
          className="card p-4 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <div className="text-sm truncate">{e.title}</div>
            <div className="text-xs text-neutral-500">
              {e.document_title} · {new Date(e.created_at).toLocaleString()}
            </div>
          </div>
          <div
            className={cn(
              "text-lg font-semibold",
              e.score == null
                ? "text-neutral-500"
                : e.score >= 80
                ? "text-emerald-400"
                : e.score >= 50
                ? "text-amber-400"
                : "text-accent"
            )}
          >
            {e.score == null ? "—" : `${e.score}%`}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AudioPanel({
  chapters,
  color,
}: {
  chapters: ModuleAudioChapter[];
  color: string;
}) {
  if (chapters.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-neutral-500">
        {t("module.audio.empty")}
      </div>
    );
  }
  // Group by document
  const groups = new Map<string, ModuleAudioChapter[]>();
  for (const ch of chapters) {
    const arr = groups.get(ch.document_id) ?? [];
    arr.push(ch);
    groups.set(ch.document_id, arr);
  }
  return (
    <ul className="flex flex-col gap-5">
      {Array.from(groups.entries()).map(([docId, items]) => (
        <li key={docId}>
          <div
            className="text-xs uppercase tracking-wide text-neutral-500 mb-2"
            style={{ color: color }}
          >
            {items[0].document_title}
          </div>
          <ul className="flex flex-col gap-2">
            {items.map((ch) => (
              <li key={ch.id} className="card p-3 flex items-center gap-3">
                <span className="text-accent font-mono text-xs min-w-[2ch] text-right">
                  {String(ch.chapter_number).padStart(2, "0")}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{ch.chapter_title}</div>
                  <div className="text-xs text-neutral-500">
                    {formatDuration(ch.duration_ms)} · {ch.voice}
                  </div>
                </div>
                <audio
                  controls
                  preload="none"
                  src={api.audio.fileUrl(ch.id)}
                  className="h-7 max-w-[200px] [color-scheme:dark]"
                />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function SummariesPanel({ summaries }: { summaries: ModuleSummary[] }) {
  if (summaries.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-neutral-500">
        {t("module.summaries.empty")}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {summaries.map((s) => (
        <li key={s.id} className="card p-4">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-xs text-accent font-mono">
              {String(s.chapter_number).padStart(2, "0")}
            </span>
            <span className="text-sm font-medium">
              {s.chapter_title || `${t("learn.tab.chapters")} ${s.chapter_number}`}
            </span>
            <span className="text-xs text-neutral-500 ml-auto">
              {t(`summary.level.${s.level}`)} · {s.document_title}
            </span>
          </div>
          <div className="text-sm text-neutral-200 whitespace-pre-wrap line-clamp-6">
            {s.content}
          </div>
        </li>
      ))}
    </ul>
  );
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
