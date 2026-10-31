// Wissenspflege in der Kopfzeile: Countdown vor dem Start, im Lauf was gerade wo passiert; Klick klappt
// Einzelheiten aus. Abbrechen geht in beiden Phasen, danach ruht sie zwei Stunden
import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";

interface State {
  status: "idle" | "countdown" | "running" | "snoozed";
  until?: number;
  open: { chunks: number; chunkDocs: number; chapters: number; chapterDocs: number };
  phase?: "embeddings" | "concepts";
  doc?: string;
  detail?: string;
  done: number;
  total: number;
}

export function MaintenanceIndicator() {
  const [st, setSt] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const active = st?.status === "countdown" || st?.status === "running";

  useEffect(() => {
    const load = () => void request<State>("/api/maintenance").then(setSt).catch(() => undefined);
    load();
    const iv = setInterval(load, active ? 3000 : 30000);
    return () => clearInterval(iv);
  }, [active]);
  // Sekundentakt nur für den Countdown
  useEffect(() => {
    if (st?.status !== "countdown") return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [st?.status]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!st || !active) return null;
  const act = async (path: string) => setSt(await request<State>(`/api/maintenance/${path}`, { method: "POST" }));
  const secs = Math.max(0, Math.round(((st.until ?? now) - now) / 1000));
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  const phase = st.phase ? t(`maintenance.phase.${st.phase}`) : "";
  const pill =
    st.status === "countdown"
      ? secs > 0
        ? t("maintenance.pillCountdown", { s: secs })
        : t("maintenance.pillWaiting")
      : `${t("maintenance.pillRunning", { phase: st.phase ? t(`maintenance.short.${st.phase}`) : "" })}${st.total ? ` · ${st.done}/${st.total}` : ""}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn("px-2 py-1 rounded-md text-xs border whitespace-nowrap", st.status === "countdown" ? "border-amber-500/40 bg-amber-500/10" : "border-accent/40 bg-accent/10 text-accent")}
      >
        {pill}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-[min(26rem,90vw)] card p-4 flex flex-col gap-4">
          <div className="text-base font-semibold">{t("maintenance.title")}</div>
          {st.status === "countdown" ? (
            <>
              <p className="text-sm">{secs > 0 ? t("maintenance.countdownHint", { s: secs }) : t("maintenance.waitingHint")}</p>
              <ul className="text-xs text-neutral-500 flex flex-col gap-1">
                {st.open.chunks > 0 && <li>{t("maintenance.openChunks", { docs: st.open.chunkDocs, n: st.open.chunks })}</li>}
                {st.open.chapters > 0 && <li>{t("maintenance.openChapters", { docs: st.open.chapterDocs, n: st.open.chapters })}</li>}
              </ul>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="text-sm">{phase}</div>
              {st.doc && <div className="text-sm truncate">{st.doc}</div>}
              {st.detail && <div className="text-xs text-neutral-500 truncate">{st.detail}</div>}
              {st.total > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-neutral-800 overflow-hidden" aria-hidden>
                    <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-neutral-500">{t("maintenance.progress", { done: st.done, total: st.total })}</span>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => void act("cancel")}>
              {t("common.cancel")}
            </Button>
            {st.status === "countdown" && <Button onClick={() => void act("start")}>{t("maintenance.startNow")}</Button>}
          </div>
          <p className="text-xs text-neutral-500">{t("maintenance.cancelHint")}</p>
        </div>
      )}
    </div>
  );
}
