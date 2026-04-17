import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Chapter, type OllamaStatus, type Summary, type SummaryLevel } from "../lib/api";
import { useToast } from "./ui/Toast";
import { getSettings } from "../lib/settings";
import { t } from "../lib/i18n";
import { cn } from "../lib/cn";

interface Props {
  docId: string;
}

const LEVELS: Array<{ id: SummaryLevel }> = [
  { id: "bullets" },
  { id: "paragraph" },
  { id: "detailed" },
];

export function Summaries({ docId }: Props) {
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [model, setModel] = useState<string>("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [streamBuf, setStreamBuf] = useState<Record<string, string>>({});
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [chs, sums, st] = await Promise.all([
        api.chapters.list(docId),
        api.summary.document(docId),
        api.summary.status(),
      ]);
      setChapters(chs);
      setSummaries(sums);
      setStatus(st);
      if (!model) {
        const preferred = getSettings().defaultOllamaModel;
        setModel(preferred && st.models.includes(preferred) ? preferred : st.defaultModel);
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }, [docId, model, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const byChapter = useMemo(() => {
    const map = new Map<string, Summary[]>();
    for (const s of summaries) {
      const arr = map.get(s.chapter_id) ?? [];
      arr.push(s);
      map.set(s.chapter_id, arr);
    }
    return map;
  }, [summaries]);

  async function generate(chapter: Chapter, level: SummaryLevel) {
    const key = `${chapter.id}:${level}`;
    setBusy((b) => ({ ...b, [key]: true }));
    setStreamBuf((s) => ({ ...s, [key]: "" }));
    try {
      await api.summary.generateStream(chapter.id, level, model, {
        onToken: (tok) =>
          setStreamBuf((s) => ({ ...s, [key]: (s[key] ?? "") + tok })),
        onDone: async () => {
          const sums = await api.summary.document(docId);
          setSummaries(sums);
          setStreamBuf((s) => {
            const next = { ...s };
            delete next[key];
            return next;
          });
          toast.show(
            t("summary.generatedToast", { num: chapter.number }),
            "success"
          );
        },
        onError: (msg) => toast.show(msg, "error"),
      });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  async function remove(id: string) {
    if (!confirm(t("summary.deleteConfirm"))) return;
    try {
      await api.summary.remove(id);
      setSummaries(await api.summary.document(docId));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  if (status && !status.available) {
    return (
      <div className="card p-8 text-center flex flex-col gap-3">
        <div className="text-4xl">🤖</div>
        <h2 className="text-lg font-semibold">{t("summary.noOllama.title")}</h2>
        <p className="text-sm text-neutral-400 max-w-md mx-auto">
          {t("summary.noOllama.hint", {
            cmd: "ollama serve",
            envVar: "PM_OLLAMA_URL",
          })}
        </p>
        <p className="text-xs text-neutral-500">
          {t("summary.noOllama.tried")} <code>{status.url}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("summary.title")}</h2>
          <p className="text-xs text-neutral-500 mt-1">{t("summary.subtitle")}</p>
        </div>
        {status && status.models.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">{t("summary.model")}</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="input !py-1.5 !text-xs"
            >
              {status.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {!chapters ? (
        <div className="text-sm text-neutral-500">{t("common.loading")}</div>
      ) : chapters.length === 0 ? (
        <div className="card p-8 text-center text-sm text-neutral-500">
          {t("summary.empty.chapters")}
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {chapters.map((ch) => (
            <ChapterSummary
              key={ch.id}
              chapter={ch}
              summaries={byChapter.get(ch.id) ?? []}
              busy={busy}
              streamBuf={streamBuf}
              onGenerate={(lvl) => generate(ch, lvl)}
              onDelete={remove}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChapterSummary({
  chapter,
  summaries,
  busy,
  streamBuf,
  onGenerate,
  onDelete,
}: {
  chapter: Chapter;
  summaries: Summary[];
  busy: Record<string, boolean>;
  streamBuf: Record<string, string>;
  onGenerate: (level: SummaryLevel) => void;
  onDelete: (id: string) => void;
}) {
  const latestByLevel = useMemo(() => {
    const map = new Map<SummaryLevel, Summary>();
    for (const s of summaries) {
      if (!map.has(s.level)) map.set(s.level, s);
    }
    return map;
  }, [summaries]);

  const [activeLevel, setActiveLevel] = useState<SummaryLevel>(
    summaries[0]?.level ?? "bullets"
  );

  return (
    <li className="card p-5 flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-accent text-sm">
          {String(chapter.number).padStart(2, "0")}
        </span>
        <h3 className="font-semibold truncate">
          {chapter.title || `${t("learn.tab.chapters")} ${chapter.number}`}
        </h3>
        <span className="text-xs text-neutral-500 ml-auto">
          {t("chapters.chars", { n: chapter.text.length.toLocaleString() })}
        </span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {LEVELS.map((lvl) => {
          const key = `${chapter.id}:${lvl.id}`;
          const has = latestByLevel.has(lvl.id);
          const isBusy = busy[key];
          return (
            <div key={lvl.id} className="flex items-center gap-1">
              <button
                onClick={() => setActiveLevel(lvl.id)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs border transition-colors",
                  activeLevel === lvl.id && has
                    ? "bg-accent/15 border-accent-subtle text-accent"
                    : "border-border text-neutral-400 hover:border-border-strong",
                  !has && "opacity-60"
                )}
              >
                {t(`summary.level.${lvl.id}`)}
                {has && " ✓"}
              </button>
              <button
                onClick={() => onGenerate(lvl.id)}
                disabled={isBusy}
                className="text-[11px] text-neutral-500 hover:text-accent disabled:opacity-50 px-1"
                title={has ? t("summary.generate.regen") : t("summary.generate.new")}
              >
                {isBusy ? "…" : has ? "↻" : t("summary.generate.new")}
              </button>
            </div>
          );
        })}
      </div>

      {(() => {
        const activeKey = `${chapter.id}:${activeLevel}`;
        const live = streamBuf[activeKey];
        if (live !== undefined && live.length > 0) {
          return <LiveSummary text={live} />;
        }
        if (latestByLevel.has(activeLevel)) {
          return <SummaryBody summary={latestByLevel.get(activeLevel)!} onDelete={onDelete} />;
        }
        return null;
      })()}
    </li>
  );
}

function LiveSummary({ text }: { text: string }) {
  return (
    <article className="card p-4 bg-bg-elevated border-accent">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        <span className="text-[11px] uppercase tracking-wide text-accent">
          {t("summary.generatingLive")}
        </span>
      </div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed text-neutral-200">
        {text}
        <span className="inline-block w-2 h-4 bg-accent/70 ml-1 align-middle animate-pulse" />
      </div>
    </article>
  );
}

function SummaryBody({ summary, onDelete }: { summary: Summary; onDelete: (id: string) => void }) {
  return (
    <article className="card p-4 bg-bg-elevated border-accent-subtle">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[11px] uppercase tracking-wide text-accent">
          {t(`summary.level.${summary.level}`)} · {summary.model}
        </span>
        <button
          onClick={() => onDelete(summary.id)}
          className="text-xs text-neutral-500 hover:text-accent"
        >
          {t("summary.delete")}
        </button>
      </div>
      <div className="prose prose-invert prose-sm max-w-none leading-relaxed whitespace-pre-wrap">
        {renderLight(summary.content)}
      </div>
    </article>
  );
}

function renderLight(content: string): React.ReactNode {
  // Leichte Markdown-Behandlung: ## Headings, - Bullets, sonst plain.
  const lines = content.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];

  function flushBullets() {
    if (bulletBuffer.length === 0) return;
    nodes.push(
      <ul key={`b-${nodes.length}`} className="list-disc pl-5 space-y-1">
        {bulletBuffer.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushBullets();
      nodes.push(<div key={`sp-${nodes.length}`} className="h-2" />);
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      flushBullets();
      nodes.push(
        <h4 key={`h-${nodes.length}`} className="text-sm font-semibold text-neutral-100 mt-2">
          {line.replace(/^#+\s*/, "")}
        </h4>
      );
    } else if (/^[-*]\s/.test(line)) {
      bulletBuffer.push(line.replace(/^[-*]\s*/, ""));
    } else {
      flushBullets();
      nodes.push(
        <p key={`p-${nodes.length}`} className="text-sm text-neutral-200">
          {line}
        </p>
      );
    }
  }
  flushBullets();
  return nodes;
}
