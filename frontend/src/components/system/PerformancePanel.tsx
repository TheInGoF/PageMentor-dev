// Diagnose → Leistung: Auslastung wie im Task-Manager, schlicht für die Fernüberwachung.
// Je Wert eine Kachel mit aktuellem Stand und Verlauf der letzten 5 Minuten (alle 2 s)
import { useEffect, useState } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";

interface Sample {
  t: number;
  cpu: number;
  ramUsed: number;
  gpu: number | null;
  vramUsed: number | null;
  gpuTemp: number | null;
  power: number | null;
}
interface Info {
  cpuModel: string;
  cores: number;
  ramTotal: number;
  gpuName: string | null;
  vramTotal: number | null;
  powerLimit: number | null;
  diskFree: number | null;
  diskTotal: number | null;
}

const WINDOW_MS = 15 * 60_000;
// Logarithmische Zeitachse wie im Task-Manager: rechts die letzten Sekunden breit, nach links immer gedrängter.
// TAU legt fest, ab wann gestaucht wird (die letzten ~10 s sind fast linear)
const TAU_MS = 10_000;
function logX(ageMs: number, width: number): number {
  const f = Math.log1p(Math.max(0, ageMs) / TAU_MS) / Math.log1p(WINDOW_MS / TAU_MS);
  return width * (1 - Math.min(1, f));
}
const TICKS: Array<{ ms: number; label: string }> = [
  { ms: 10_000, label: "10 s" },
  { ms: 60_000, label: "1 min" },
  { ms: 5 * 60_000, label: "5 min" },
];
const gb = (b: number) => (b / 1024 ** 3).toFixed(1).replace(".", ",");

export function PerformancePanel() {
  const [data, setData] = useState<{ info: Info; samples: Sample[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false;
    const load = () =>
      void request<{ info: Info; samples: Sample[] }>("/api/system/stats")
        .then((r) => {
          if (stop) return;
          setData(r);
          setFailed(false);
        })
        .catch(() => !stop && setFailed(true));
    load();
    const iv = setInterval(load, 2000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, []);

  if (!data) return <p className="text-sm text-neutral-500">{failed ? t("perf.failed") : t("common.loading")}</p>;
  const { info, samples } = data;
  const last = samples[samples.length - 1];
  const series = (pick: (s: Sample) => number | null) => samples.map((s) => ({ t: s.t, v: pick(s) }));
  const hasGpu = samples.some((s) => s.gpu !== null);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <Tile title={t("perf.cpu")} value={last ? `${Math.round(last.cpu)} %` : "–"} sub={`${info.cpuModel} · ${t("perf.cores", { n: info.cores })}`} points={series((s) => s.cpu)} max={100} />
        <Tile
          title={t("perf.ram")}
          value={last ? `${gb(last.ramUsed)} / ${gb(info.ramTotal)} GB` : "–"}
          sub={last ? `${Math.round((last.ramUsed / info.ramTotal) * 100)} %` : ""}
          points={series((s) => s.ramUsed)}
          max={info.ramTotal}
        />
        {hasGpu ? (
          <>
            <Tile title={t("perf.gpu")} value={last?.gpu != null ? `${Math.round(last.gpu)} %` : "–"} sub={info.gpuName ?? ""} points={series((s) => s.gpu)} max={100} />
            <Tile
              title={t("perf.vram")}
              value={last?.vramUsed != null && info.vramTotal ? `${gb(last.vramUsed)} / ${gb(info.vramTotal)} GB` : "–"}
              sub={last?.vramUsed != null && info.vramTotal ? `${Math.round((last.vramUsed / info.vramTotal) * 100)} %` : ""}
              points={series((s) => s.vramUsed)}
              max={info.vramTotal ?? 1}
            />
            <Tile
              title={t("perf.gpuTemp")}
              value={last?.gpuTemp != null ? `${Math.round(last.gpuTemp)} °C` : "–"}
              sub={t("perf.tempMax", { n: Math.round(Math.max(0, ...samples.map((s) => s.gpuTemp ?? 0))) })}
              points={series((s) => s.gpuTemp)}
              max={100}
              warn={(last?.gpuTemp ?? 0) >= 83}
            />
            <Tile
              title={t("perf.power")}
              value={last?.power != null ? `${Math.round(last.power)} W` : "–"}
              sub={info.powerLimit ? t("perf.powerLimit", { w: Math.round(info.powerLimit) }) : ""}
              points={series((s) => s.power)}
              max={info.powerLimit ?? Math.max(1, ...samples.map((s) => s.power ?? 0))}
            />
          </>
        ) : (
          <div className="card p-4 text-sm text-neutral-500">{t("perf.noGpu")}</div>
        )}
      </div>
      {info.diskTotal && info.diskFree !== null && (
        <div className="card p-4 flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{t("perf.disk")}</span>
            <span className="text-sm tabular-nums">{t("perf.diskFree", { free: gb(info.diskFree), total: gb(info.diskTotal) })}</span>
          </div>
          <div className="h-2 rounded bg-bg-elevated overflow-hidden">
            <div className={cn("h-full", info.diskFree / info.diskTotal < 0.1 ? "bg-red-500" : "bg-accent")} style={{ width: `${(1 - info.diskFree / info.diskTotal) * 100}%` }} />
          </div>
        </div>
      )}
      <p className="text-xs text-neutral-500">
        {t("perf.hint")} {t("perf.tempHint")}
      </p>
    </div>
  );
}

function Tile({ title, value, sub, points, max, warn }: { title: string; value: string; sub: string; points: Array<{ t: number; v: number | null }>; max: number; warn?: boolean }) {
  return (
    <div className="card p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className={cn("text-base font-semibold tabular-nums", warn && "text-red-500")}>{value}</span>
      </div>
      <Chart points={points} max={max} warn={warn} />
      <div className="relative h-3 text-[10px] text-neutral-500 tabular-nums" aria-hidden>
        <span className="absolute left-0">15 min</span>
        {TICKS.map((k) => (
          <span key={k.ms} className="absolute -translate-x-1/2" style={{ left: `${(logX(k.ms, 1) * 100).toFixed(1)}%` }}>
            {k.label}
          </span>
        ))}
        <span className="absolute right-0">{t("perf.now")}</span>
      </div>
      <span className="text-xs text-neutral-500 truncate" title={sub}>
        {sub}
      </span>
    </div>
  );
}

// Verlauf als Fläche über 15 Minuten, Zeit logarithmisch: neue Werte kommen rechts herein und wandern nach links
function Chart({ points, max, warn }: { points: Array<{ t: number; v: number | null }>; max: number; warn?: boolean }) {
  const W = 300;
  const H = 70;
  const now = points[points.length - 1]?.t ?? Date.now();
  const xy = points
    .filter((p): p is { t: number; v: number } => p.v !== null)
    .map((p) => [logX(now - p.t, W), H - Math.min(1, p.v / (max || 1)) * H] as const)
    .filter(([x]) => x >= 0);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("w-full h-20 rounded bg-bg-elevated", warn ? "text-red-500" : "text-accent")} aria-hidden>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="currentColor" strokeOpacity={0.08} vectorEffect="non-scaling-stroke" />
      ))}
      {TICKS.map((k) => (
        <line key={k.ms} x1={logX(k.ms, W)} x2={logX(k.ms, W)} y1={0} y2={H} stroke="currentColor" strokeOpacity={0.12} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      ))}
      {xy.length > 1 && (
        <>
          <path d={`${line} L${xy[xy.length - 1][0]},${H} L${xy[0][0]},${H} Z`} fill="currentColor" fillOpacity={0.15} />
          <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}
