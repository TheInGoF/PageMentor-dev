import { useEffect, useMemo, useRef, useState } from "react";
import { api, type RagSource } from "../lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";

interface Props {
  docId: string;
  /** Optional: Springe zu einem anderen Tab (Reader, Chapters) wenn der
   *  User auf eine Quellen-Card klickt. Wird vom LearningMenu durchgereicht. */
  onJumpToChapter?: (chapterId: string) => void;
}

export function RagQA({ docId, onJumpToChapter }: Props) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<RagSource[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "retrieving" | "answering" | "done">("idle");
  const [history, setHistory] = useState<
    Array<{ q: string; a: string; sources: RagSource[]; ts: number }>
  >([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);
  const toast = useToast();

  // Auto-Focus auf das Frage-Feld beim Mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sanftes Scrollen nach unten während Tokens reinkommen.
  useEffect(() => {
    if (busy && answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [answer, busy]);

  async function ask() {
    const q = query.trim();
    if (!q || busy) return;

    setBusy(true);
    setError(null);
    setAnswer("");
    setSources(null);
    setPhase("retrieving");

    try {
      let collectedSources: RagSource[] = [];
      let collectedAnswer = "";
      await api.rag.answerStream(
        { docId, query: q, topK: 6 },
        {
          onSources: (s) => {
            collectedSources = s;
            setSources(s);
            setPhase("answering");
          },
          onToken: (chunk) => {
            collectedAnswer += chunk;
            setAnswer((prev) => prev + chunk);
          },
          onDone: () => {
            setPhase("done");
            setHistory((prev) => [
              { q, a: collectedAnswer, sources: collectedSources, ts: Date.now() },
              ...prev,
            ].slice(0, 10));
          },
          onError: (msg) => {
            setError(msg);
            setPhase("idle");
          },
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      setError(msg);
      toast.show(msg, "error");
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setQuery("");
    setAnswer("");
    setSources(null);
    setError(null);
    setPhase("idle");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl + Enter → Senden, Enter alleine → neue Zeile
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      ask();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t("qa.title")}</h2>
          <p className="text-xs text-neutral-500 mt-1">{t("qa.subtitle")}</p>
        </div>

        <div className="flex flex-col gap-2">
          <textarea
            ref={inputRef}
            className="input min-h-[80px] font-mono text-sm leading-snug"
            placeholder={t("qa.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
          />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[11px] text-neutral-500">
              {t("qa.hint.shortcut")}
            </span>
            <div className="flex gap-2">
              {(answer || sources) && !busy && (
                <Button variant="outline" onClick={reset}>
                  {t("qa.reset")}
                </Button>
              )}
              <Button onClick={ask} disabled={busy || !query.trim()}>
                {busy
                  ? phase === "retrieving"
                    ? t("qa.status.retrieving")
                    : t("qa.status.answering")
                  : t("qa.ask")}
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-200">
            {error}
          </div>
        )}
      </section>

      {(sources || answer) && (
        <section className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <article className="card p-5 flex flex-col gap-3">
            <header className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-neutral-200">
                {t("qa.answer")}
              </h3>
              {phase === "answering" && (
                <span className="text-[11px] text-accent animate-pulse">
                  {t("qa.streaming")}
                </span>
              )}
            </header>
            <div
              ref={answerRef}
              className="prose prose-invert prose-sm max-w-none leading-relaxed text-neutral-100 max-h-[60vh] overflow-y-auto"
            >
              {answer ? (
                <RenderAnswer text={answer} sources={sources ?? []} />
              ) : (
                <p className="text-sm text-neutral-500 italic">
                  {phase === "retrieving"
                    ? t("qa.status.retrieving.long")
                    : t("qa.empty")}
                </p>
              )}
            </div>
          </article>

          <aside className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-neutral-200 px-1">
              {sources
                ? t("qa.sources.count", { n: sources.length })
                : t("qa.sources.title")}
            </h3>
            {sources?.map((s, idx) => (
              <SourceCard
                key={s.id}
                index={idx + 1}
                source={s}
                onJump={onJumpToChapter}
              />
            ))}
          </aside>
        </section>
      )}

      {history.length > 0 && (
        <section className="card p-5 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-neutral-200">
            {t("qa.history")}
          </h3>
          <ul className="flex flex-col gap-2">
            {history.slice(1).map((h) => (
              <li
                key={h.ts}
                className="border border-border rounded-lg p-3 text-sm cursor-pointer hover:border-border-strong"
                onClick={() => {
                  setQuery(h.q);
                  setAnswer(h.a);
                  setSources(h.sources);
                  setPhase("done");
                }}
                title={t("qa.history.reopen")}
              >
                <div className="font-medium text-neutral-200 truncate">
                  {h.q}
                </div>
                <div className="text-[11px] text-neutral-500 mt-1">
                  {t("qa.sources.count", { n: h.sources.length })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SourceCard({
  index,
  source,
  onJump,
}: {
  index: number;
  source: RagSource;
  onJump?: (chapterId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pageRange =
    source.start_page === source.end_page
      ? `${t("chapters.pages")} ${source.start_page}`
      : `${t("chapters.pages")} ${source.start_page}–${source.end_page}`;
  const scorePct = Math.round(source.score * 100);

  return (
    <div
      id={`rag-source-${index}`}
      className="card p-3 flex flex-col gap-2 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-accent text-xs">[{index}]</span>
          <span className="text-xs text-neutral-300 font-medium">
            {t("qa.source.chapter", {
              num: source.chapter_number,
              title: source.chapter_title,
            })}
          </span>
        </div>
        <span
          className="text-[10px] text-neutral-500 font-mono"
          title={t("qa.source.score")}
        >
          {scorePct}%
        </span>
      </div>
      <div className="text-[11px] text-neutral-500">{pageRange}</div>
      <p
        className={cn(
          "text-xs text-neutral-400 leading-relaxed whitespace-pre-wrap",
          expanded ? "" : "line-clamp-4"
        )}
      >
        {source.text}
      </p>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-neutral-400 hover:text-accent"
        >
          {expanded ? t("qa.source.less") : t("qa.source.more")}
        </button>
        {onJump && (
          <button
            type="button"
            onClick={() => onJump(source.chapter_id)}
            className="text-[11px] text-accent hover:underline"
          >
            {t("qa.source.openChapter")} →
          </button>
        )}
      </div>
    </div>
  );
}

/** Rendert den Antworttext mit klickbaren [n]-Belegen (scrollt zur
 *  entsprechenden Source-Card in der Sidebar). Light-Markdown:
 *  ## Headings, - Bullets, sonst Absätze. */
function RenderAnswer({
  text,
  sources,
}: {
  text: string;
  sources: RagSource[];
}) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const nodes: React.ReactNode[] = [];
  let bulletBuffer: React.ReactNode[][] = [];

  function flushBullets() {
    if (bulletBuffer.length === 0) return;
    nodes.push(
      <ul key={`b-${nodes.length}`} className="list-disc pl-5 space-y-1 my-2">
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
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      flushBullets();
      nodes.push(
        <h4
          key={`h-${nodes.length}`}
          className="text-sm font-semibold text-neutral-100 mt-3 mb-1"
        >
          {renderInline(line.replace(/^#+\s*/, ""), sources)}
        </h4>
      );
    } else if (/^[-*]\s/.test(line)) {
      bulletBuffer.push(renderInline(line.replace(/^[-*]\s*/, ""), sources));
    } else {
      flushBullets();
      nodes.push(
        <p key={`p-${nodes.length}`} className="text-sm text-neutral-200 my-1.5">
          {renderInline(line, sources)}
        </p>
      );
    }
  }
  flushBullets();
  return <>{nodes}</>;
}

/** Findet [1], [2], [1][3], … und macht sie zu klickbaren Links die
 *  zur entsprechenden Source-Card scrollen. Auch **bold** und *italic*. */
function renderInline(text: string, sources: RagSource[]): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Pattern: [n] mit n = 1..99
  const pattern = /\[(\d{1,2})\]/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(formatBold(text.slice(lastIdx, match.index), key++));
    }
    const n = parseInt(match[1], 10);
    const exists = n > 0 && n <= sources.length;
    parts.push(
      <a
        key={`c-${key++}`}
        href={`#rag-source-${n}`}
        onClick={(e) => {
          e.preventDefault();
          const el = document.getElementById(`rag-source-${n}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("ring-2", "ring-accent");
            setTimeout(() => el.classList.remove("ring-2", "ring-accent"), 1500);
          }
        }}
        className={cn(
          "inline-flex items-center justify-center font-mono text-[10px] mx-0.5 px-1 py-0.5 rounded align-baseline",
          exists
            ? "bg-accent/15 text-accent hover:bg-accent/25"
            : "bg-neutral-700 text-neutral-400"
        )}
        title={
          exists
            ? `${sources[n - 1].chapter_title} (${t("chapters.pages")} ${sources[n - 1].start_page}${sources[n - 1].end_page !== sources[n - 1].start_page ? "–" + sources[n - 1].end_page : ""})`
            : undefined
        }
      >
        {n}
      </a>
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(formatBold(text.slice(lastIdx), key++));
  }
  return <>{parts}</>;
}

function formatBold(text: string, key: number): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    if (m[1]) {
      parts.push(<strong key={`bld-${key}-${i++}`}>{m[1]}</strong>);
    } else {
      parts.push(<em key={`itc-${key}-${i++}`}>{m[2]}</em>);
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length === 0 ? text : <span key={`s-${key}`}>{parts}</span>;
}
