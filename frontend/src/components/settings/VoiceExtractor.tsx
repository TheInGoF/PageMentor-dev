// Stimm-Extraktor: Video ansehen, oben grob einen Bereich ziehen (die untere Leiste zoomt hinein), unten den Ausschnitt
// auf Hundertstel genau wählen. „Übernehmen“ schneidet ihn als WAV mit 0,5 s Stille davor und danach
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { Notice } from "./parts";

type Range = [number, number];

export const isVideoFile = (f: File) => f.type.startsWith("video/") || /\.(mp4|m4v|mkv|mov|webm|avi|wmv|flv|mpe?g|ts)$/i.test(f.name);

// 75,4 s → "1:15.40"
export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, "0")}`;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const MIN_SEL = 0.1;
// Griffe treffen: so viele Pixel neben einer Kante zählen als die Kante
const GRAB_PX = 10;

// Wellenform mit Bereich und Abspielposition; Ziehen und Klicken meldet Zeiten im angezeigten Bereich
function Strip(props: {
  range: Range;
  peaks: number[] | null;
  box: Range | null;
  boxClass: string;
  playhead: number | null;
  height: number;
  ticks?: boolean;
  // Ziehen: Kante verschieben, Kasten verschieben oder neuen Bereich aufziehen
  onBox: (r: Range) => void;
  onClick: (t: number) => void;
  // Kasten als Ganzes verschiebbar (Übersicht) oder Ziehen innen setzt neu (Zoom)
  movable: boolean;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "new" | "start" | "end" | "move"; t0: number; x0: number; box: Range | null; moved: boolean } | null>(null);
  const [a, b] = props.range;
  const span = Math.max(1e-6, b - a);
  const toT = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return a + clamp((clientX - r.left) / r.width, 0, 1) * span;
  };
  const toPx = (time: number) => ((time - a) / span) * (ref.current?.getBoundingClientRect().width ?? 1);

  const down = (e: ReactPointerEvent) => {
    ref.current!.setPointerCapture(e.pointerId);
    const time = toT(e.clientX);
    const x = e.clientX - ref.current!.getBoundingClientRect().left;
    let mode: "new" | "start" | "end" | "move" = "new";
    if (props.box) {
      const xs = toPx(props.box[0]), xe = toPx(props.box[1]);
      if (Math.abs(x - xs) <= GRAB_PX) mode = "start";
      else if (Math.abs(x - xe) <= GRAB_PX) mode = "end";
      else if (props.movable && x > xs && x < xe) mode = "move";
    }
    drag.current = { mode, t0: time, x0: e.clientX, box: props.box, moved: false };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
    if (!d.moved) return;
    const time = toT(e.clientX);
    if (d.mode === "new") props.onBox(time >= d.t0 ? [d.t0, time] : [time, d.t0]);
    else if (d.mode === "start" && d.box) props.onBox([Math.min(time, d.box[1] - MIN_SEL), d.box[1]]);
    else if (d.mode === "end" && d.box) props.onBox([d.box[0], Math.max(time, d.box[0] + MIN_SEL)]);
    else if (d.mode === "move" && d.box) {
      const w = d.box[1] - d.box[0];
      const s = clamp(d.box[0] + (time - d.t0), a, b - w);
      props.onBox([s, s + w]);
    }
  };
  const up = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) props.onClick(toT(e.clientX));
  };

  const pct = (time: number) => `${((time - a) / span) * 100}%`;
  const n = props.peaks?.length ?? 0;
  // Teilstriche: etwa zehn runde Schritte
  const step = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => span / s <= 12) ?? 1200;
  const ticks = props.ticks ? Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => Math.ceil(a / step) * step + i * step).filter((x) => x <= b - span * 0.04) : [];

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={ref}
        role="slider"
        aria-label={props.label}
        aria-valuemin={a}
        aria-valuemax={b}
        aria-valuenow={props.box?.[0] ?? a}
        className="relative w-full rounded-md border border-border bg-bg-elevated cursor-crosshair select-none touch-none overflow-hidden"
        style={{ height: props.height }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      >
        {props.peaks && (
          <svg className="absolute inset-0 w-full h-full text-neutral-400" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden>
            {props.peaks.map((p, i) => (
              <rect key={i} x={i} width={0.8} y={50 - Math.max(0.5, p * 48)} height={Math.max(1, p * 96)} fill="currentColor" />
            ))}
          </svg>
        )}
        {!props.peaks && <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">{t("voiceExtract.loadingWave")}</div>}
        {props.box && props.box[1] > a && props.box[0] < b && (
          <div className={cn("absolute top-0 bottom-0 border-x-2", props.boxClass)} style={{ left: pct(Math.max(a, props.box[0])), width: `calc(${pct(Math.min(b, props.box[1]))} - ${pct(Math.max(a, props.box[0]))})` }}>
            {/* Sichtbare Griffe an den Kanten */}
            <span className="absolute -left-[5px] top-1/2 -translate-y-1/2 w-2 h-8 rounded-sm bg-current" />
            <span className="absolute -right-[5px] top-1/2 -translate-y-1/2 w-2 h-8 rounded-sm bg-current" />
          </div>
        )}
        {props.playhead !== null && props.playhead >= a && props.playhead <= b && (
          <div className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none" style={{ left: pct(props.playhead) }} />
        )}
      </div>
      {props.ticks && (
        <div className="relative h-4 text-[10px] text-neutral-500">
          {ticks.map((x) => (
            <span key={x} className="absolute -translate-x-1/2 tabular-nums" style={{ left: pct(x) }}>
              {fmtTime(x)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function VoiceExtractor({ file, onExtract, onClose }: { file: File; onExtract: (wav: File, seconds: number) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [src] = useState(() => URL.createObjectURL(file));
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dur, setDur] = useState(0);
  const [view, setView] = useState<Range>([0, 0]);
  const [sel, setSel] = useState<Range | null>(null);
  const [overview, setOverview] = useState<number[] | null>(null);
  const [zoomPeaks, setZoomPeaks] = useState<number[] | null>(null);
  const [now, setNow] = useState(0);
  const [noPreview, setNoPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const stopAt = useRef<number | null>(null);
  const cutAudio = useRef<HTMLAudioElement | null>(null);

  // Datei an die App geben (bleibt lokal), danach Länge und Übersicht
  useEffect(() => {
    let gone = false;
    let sid: string | null = null;
    fetch("/api/voices/extract", { method: "PUT", body: file, headers: { "x-filename": encodeURIComponent(file.name) } })
      .then(async (r) => {
        const j = (await r.json()) as { id?: string; durationSec?: number; error?: string };
        if (!r.ok || !j.id) throw new Error(j.error ?? `HTTP ${r.status}`);
        sid = j.id;
        if (gone) return;
        setId(j.id);
        setDur(j.durationSec!);
        setView([0, j.durationSec!]);
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
      URL.revokeObjectURL(src);
      cutAudio.current?.pause();
      if (sid) void fetch(`/api/voices/extract/${sid}`, { method: "DELETE" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!id || !dur) return;
    void request<{ peaks: number[] }>(`/api/voices/extract/${id}/peaks?from=0&to=${dur}&bins=600`).then((r) => setOverview(r.peaks)).catch(() => undefined);
  }, [id, dur]);

  // Wellenform der Zoomleiste, kurz nach dem letzten Ziehen
  useEffect(() => {
    if (!id || view[1] <= view[0]) return;
    setZoomPeaks(null);
    const tm = setTimeout(() => {
      void request<{ peaks: number[] }>(`/api/voices/extract/${id}/peaks?from=${view[0]}&to=${view[1]}&bins=800`).then((r) => setZoomPeaks(r.peaks)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(tm);
  }, [id, view]);

  // Abspielposition flüssig nachführen; beim Auswahl-Abspielen am Ende anhalten
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        setNow(v.currentTime);
        if (stopAt.current !== null && v.currentTime >= stopAt.current) {
          v.pause();
          stopAt.current = null;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const seek = (time: number) => {
    if (video.current) video.current.currentTime = clamp(time, 0, dur);
    setNow(time);
  };
  const setViewSafe = (r: Range) => {
    const w = Math.max(0.5, r[1] - r[0]);
    const s = clamp(r[0], 0, Math.max(0, dur - w));
    setView([s, Math.min(dur, s + w)]);
  };
  const setSelSafe = (r: Range) => setSel([clamp(r[0], 0, dur), clamp(Math.max(r[1], r[0] + MIN_SEL), 0, dur)]);
  const playSel = () => {
    if (!sel || !video.current) return;
    video.current.currentTime = sel[0];
    stopAt.current = sel[1];
    void video.current.play();
  };
  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    stopAt.current = null;
    if (v.paused) void v.play();
    else v.pause();
  };
  const zoomToSel = () => sel && setViewSafe([sel[0] - (sel[1] - sel[0]) * 0.25, sel[1] + (sel[1] - sel[0]) * 0.25]);

  async function extract() {
    if (!id || !sel) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/voices/extract/${id}/cut`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: sel[0], end: sel[1] }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      const blob = await r.blob();
      const base = file.name.replace(/\.[^.]+$/, "");
      const wav = new File([blob], `${base} ${fmtTime(sel[0]).replace(":", "-")}.wav`, { type: "audio/wav" });
      cutAudio.current?.pause();
      cutAudio.current = new Audio(URL.createObjectURL(blob));
      void cutAudio.current.play();
      onExtract(wav, sel[1] - sel[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const len = sel ? sel[1] - sel[0] : 0;
  const numInput = (value: number, set: (v: number) => void, label: string) => (
    <label className="flex flex-col gap-1 text-xs text-neutral-400">
      {label}
      <input
        type="number"
        className="input w-32 tabular-nums"
        step={0.01}
        min={0}
        max={dur}
        value={value.toFixed(2)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) set(v);
        }}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium flex-1 truncate">{t("voiceExtract.title", { name: file.name })}</div>
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,320px)_1fr] gap-3 items-start">
        <div className="flex flex-col gap-2 min-w-0">
          {noPreview ? (
            <Notice>{t("voiceExtract.noPreview")}</Notice>
          ) : (
            <video ref={video} src={src} className="block w-full max-w-full rounded-md bg-black aspect-video object-contain cursor-pointer" onClick={togglePlay} onError={() => setNoPreview(true)} playsInline />
          )}
          <div className="flex items-center gap-2 text-xs text-neutral-500 tabular-nums">
            <button type="button" className="chip" onClick={togglePlay} disabled={noPreview}>
              {video.current && !video.current.paused ? "❚❚" : "▶"}
            </button>
            {fmtTime(now)} / {fmtTime(dur)}
          </div>
        </div>
        <div className="flex flex-col gap-3 min-w-0">
          {!id && !error && <div className="text-sm text-neutral-500">{t("voiceExtract.loading")}</div>}
          {id && (
            <>
              <div className="text-xs text-neutral-500">{t("voiceExtract.overviewHint")}</div>
              <Strip
                label={t("voiceExtract.overview")}
                range={[0, dur]}
                peaks={overview}
                box={view[1] - view[0] < dur - 0.01 ? view : null}
                boxClass="border-accent bg-accent/10 text-accent"
                playhead={now}
                height={48}
                movable
                onBox={setViewSafe}
                onClick={(time) => {
                  const w = view[1] - view[0];
                  if (w < dur - 0.01) setViewSafe([time - w / 2, time + w / 2]);
                  seek(time);
                }}
              />
              <div className="text-xs text-neutral-500">{t("voiceExtract.zoomHint", { from: fmtTime(view[0]), to: fmtTime(view[1]) })}</div>
              <Strip
                label={t("voiceExtract.zoom")}
                range={view}
                peaks={zoomPeaks}
                box={sel}
                boxClass="border-emerald-500 bg-emerald-500/15 text-emerald-500"
                playhead={now}
                height={96}
                ticks
                movable={false}
                onBox={setSelSafe}
                onClick={seek}
              />
              <div className="flex flex-wrap items-end gap-2">
                {numInput(sel?.[0] ?? 0, (v) => setSelSafe([v, sel?.[1] ?? v + 1]), t("voiceExtract.start"))}
                {numInput(sel?.[1] ?? 0, (v) => setSelSafe([sel?.[0] ?? Math.max(0, v - 1), v]), t("voiceExtract.end"))}
                <Button variant="outline" onClick={() => setSelSafe([now, sel && sel[1] > now + MIN_SEL ? sel[1] : now + 5])}>
                  [ {t("voiceExtract.startHere")}
                </Button>
                <Button variant="outline" onClick={() => setSelSafe([sel && sel[0] < now - MIN_SEL ? sel[0] : Math.max(0, now - 5), now])}>
                  {t("voiceExtract.endHere")} ]
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={playSel} disabled={!sel || noPreview}>
                  ▶ {t("voiceExtract.playSel")}
                </Button>
                <Button variant="ghost" onClick={zoomToSel} disabled={!sel}>
                  {t("voiceExtract.zoomSel")}
                </Button>
                <Button variant="ghost" onClick={() => setView([0, dur])}>
                  {t("voiceExtract.zoomAll")}
                </Button>
                <span className={cn("text-xs tabular-nums", len && (len < 3 || len > 30) ? "text-amber-600" : "text-neutral-500")}>
                  {sel ? t("voiceExtract.length", { s: len.toFixed(2) }) : t("voiceExtract.noSel")}
                </span>
              </div>
              <div>
                <Button onClick={() => void extract()} disabled={!sel || busy}>
                  {busy ? t("voiceExtract.cutting") : t("voiceExtract.apply")}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
