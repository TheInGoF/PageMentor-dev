// Logs: live oder aus Tagesdateien, mit Filtern und Diagnosepaket
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { LogRow } from "./logs/LogRow";
import { LogToolbar } from "./logs/LogToolbar";
import {
  EMPTY_FILTER,
  fromLive,
  fromStored,
  matches,
  type LiveLogLine,
  type LogFilter,
  type UiLogLine,
} from "./logs/model";

const LIVE = "live";
const MAX_LIVE = 5000;

export function LogsContent() {
  const [mode, setMode] = useState<string>(LIVE);
  const [days, setDays] = useState<string[]>([]);
  const [liveLines, setLiveLines] = useState<UiLogLine[]>([]);
  const [dayLines, setDayLines] = useState<UiLogLine[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [filter, setFilter] = useState<LogFilter>(EMPTY_FILTER);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState<"connecting" | "open" | "closed">("connecting");
  const [diagBusy, setDiagBusy] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Nur mitscrollen, wenn der Nutzer unten ist
  const stickyBottomRef = useRef(true);
  const toast = useToast();

  useEffect(() => {
    api.logs
      .days()
      .then((r) => setDays(r.days.map((d) => d.day)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/admin/logs/stream");
    setConnected("connecting");
    es.onopen = () => setConnected("open");
    es.onerror = () => setConnected("closed");
    es.addEventListener("log", (ev) => {
      try {
        const line = fromLive(JSON.parse((ev as MessageEvent).data) as LiveLogLine);
        setLiveLines((prev) => {
          const next = prev.concat(line);
          return next.length > MAX_LIVE ? next.slice(next.length - MAX_LIVE) : next;
        });
      } catch {
        // kaputte Zeile ignorieren
      }
    });
    return () => es.close();
  }, []);

  // Tagesdatei laden, Filter serverseitig grob, clientseitig fein
  useEffect(() => {
    if (mode === LIVE) return;
    setLoadingDay(true);
    api.logs
      .query({ day: mode, level: filter.level, docId: filter.docId, jobId: filter.jobId })
      .then((r) => setDayLines(r.lines.map(fromStored)))
      .catch((err) => toast.show(err instanceof Error ? err.message : t("common.error"), "error"))
      .finally(() => setLoadingDay(false));
    // toast bewusst nicht in den Abhängigkeiten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, filter.level, filter.docId, filter.jobId]);

  const source = mode === LIVE ? liveLines : dayLines;
  const visible = useMemo(() => source.filter((l) => matches(l, filter)), [source, filter]);
  const areas = useMemo(() => Array.from(new Set(source.map((l) => l.area))).sort(), [source]);

  useEffect(() => {
    if (paused || mode !== LIVE) return;
    const el = scrollerRef.current;
    if (el && stickyBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [visible, paused, mode]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    stickyBottomRef.current = el.scrollHeight - (el.scrollTop + el.clientHeight) < 40;
  }

  async function createDiagnostics() {
    setDiagBusy(true);
    try {
      const r = await api.logs.createDiagnostics();
      toast.show(t("logs.diagnostics.created", { name: r.name, dir: r.dir }), "success");
      window.location.href = r.url;
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setDiagBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 flex-1">{t("logs.title")}</h3>
        <select className="input !py-1 !text-xs w-auto" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value={LIVE}>{t("logs.live")}</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {mode === LIVE && (
          <>
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
            <Button variant="ghost" onClick={() => setPaused((p) => !p)} title={t(paused ? "logs.resume" : "logs.pause")}>
              {paused ? "▶" : "⏸"}
            </Button>
            <Button variant="ghost" onClick={() => setLiveLines([])} title={t("logs.clear")}>
              {t("logs.clear")}
            </Button>
          </>
        )}
        <Button variant="outline" onClick={createDiagnostics} disabled={diagBusy}>
          {diagBusy ? t("logs.diagnostics.creating") : t("logs.diagnostics.create")}
        </Button>
      </div>

      <LogToolbar filter={filter} areas={areas} onChange={setFilter} />

      <div className="text-[11px] text-neutral-500 text-right">
        {visible.length} / {source.length} {t("logs.lines")}
      </div>

      <div ref={scrollerRef} onScroll={onScroll} className="card bg-black/60 overflow-auto h-[60vh]">
        <div className="px-1 py-2 font-mono text-[11px] leading-relaxed">
          {visible.length === 0 ? (
            <div className="text-neutral-500 text-center py-8">
              {loadingDay ? t("common.loading") : connected === "open" || mode !== LIVE ? t("logs.empty") : t("logs.connecting")}
            </div>
          ) : (
            visible.map((line, i) => (
              <LogRow
                key={`${line.ts}-${i}`}
                line={line}
                onFilter={(key, value) => setFilter((f) => ({ ...f, [key]: value }))}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
