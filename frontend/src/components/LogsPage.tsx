import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/Button";
import { t } from "../lib/i18n";

interface LogLine {
  ts: number;
  source: "pm-app" | "qwen-tts" | "arbiter" | "ollama" | "docling" | "system";
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

const SOURCES = ["pm-app", "qwen-tts", "arbiter", "ollama", "docling"] as const;

/**
 * Live log viewer. Subscribes to /api/admin/logs/stream (SSE)
 * and renders the merged stream (Backend `console.*` + Sidecar
 * diagnostic lines forwarded by the backend) into a single scrolling
 * pane. Auto-scrolls to bottom while new lines come in; pauses when
 * the user scrolls up.
 *
 * Filter chips toggle source-prefixes so a user can isolate the
 * Sidecar lines during a TTS run, or just the backend during a
 * preprocess debug.
 *
 * Embedded as a Settings tab (no own page header). The standalone
 * `LogsPage` wrapper has been removed in v1.18.098.
 */
export function LogsContent() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState<"connecting" | "open" | "closed">(
    "connecting"
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll only when the user is at the bottom — if they
  // scrolled up to read something, we don't yank them back to the
  // tail on every new line.
  const stickyBottomRef = useRef(true);

  useEffect(() => {
    const es = new EventSource("/api/admin/logs/stream");
    setConnected("connecting");
    es.onopen = () => setConnected("open");
    es.onerror = () => setConnected("closed");
    es.addEventListener("log", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as LogLine;
        setLines((prev) => {
          const next = prev.concat(data);
          // Cap memory: keep last 5000 lines.
          return next.length > 5000 ? next.slice(next.length - 5000) : next;
        });
      } catch {
        // ignore malformed events
      }
    });
    return () => {
      es.close();
    };
  }, []);

  useEffect(() => {
    if (paused) return;
    const el = scrollerRef.current;
    if (!el || !stickyBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, paused]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 40;
    stickyBottomRef.current = atBottom;
  }

  function toggleSource(src: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

  function clearLines() {
    setLines([]);
  }

  const visible = lines.filter((l) => !hidden.has(l.source));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 flex-1">
          {t("logs.title")}
        </h3>
        <span
          className={
            "text-[11px] font-mono px-2 py-0.5 rounded " +
            (connected === "open"
              ? "text-emerald-400 bg-emerald-500/10"
              : connected === "connecting"
              ? "text-amber-400 bg-amber-500/10"
              : "text-red-400 bg-red-500/10")
          }
        >
          {t(`logs.connection.${connected}`)}
        </span>
        <Button
          variant="ghost"
          onClick={() => setPaused((p) => !p)}
          title={t(paused ? "logs.resume" : "logs.pause")}
        >
          {paused ? "▶" : "⏸"}
        </Button>
        <Button variant="ghost" onClick={clearLines} title={t("logs.clear")}>
          {t("logs.clear")}
        </Button>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-neutral-500">{t("logs.filter")}:</span>
        {SOURCES.map((src) => {
          const active = !hidden.has(src);
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
        <span className="ml-auto text-neutral-500">
          {visible.length} / {lines.length} {t("logs.lines")}
        </span>
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="card bg-black/60 overflow-auto h-[60vh]"
      >
        <div className="px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-nowrap">
          {visible.length === 0 ? (
            <div className="text-neutral-500 text-center py-8">
              {connected === "open" ? t("logs.empty") : t("logs.connecting")}
            </div>
          ) : (
            visible.map((line, i) => (
              <div key={i} className="flex gap-2 hover:bg-bg-elevated/40 px-2">
                <span className="text-neutral-600 shrink-0">
                  {formatTs(line.ts)}
                </span>
                <span
                  className={
                    "shrink-0 w-20 truncate " +
                    sourceColor(line.source)
                  }
                >
                  {line.source}
                </span>
                <span
                  className={
                    "shrink-0 w-12 " + levelColor(line.level)
                  }
                >
                  {line.level}
                </span>
                <span className="text-neutral-200">
                  {line.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0") +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

function sourceColor(src: string): string {
  switch (src) {
    case "pm-app":
      return "text-sky-400";
    case "qwen-tts":
      return "text-fuchsia-400";
    case "arbiter":
      return "text-amber-400";
    case "ollama":
      return "text-emerald-400";
    case "docling":
      return "text-violet-400";
    default:
      return "text-neutral-400";
  }
}

function levelColor(lvl: string): string {
  switch (lvl) {
    case "error":
      return "text-red-400";
    case "warn":
      return "text-amber-400";
    case "debug":
      return "text-neutral-500";
    default:
      return "text-neutral-300";
  }
}
