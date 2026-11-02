// Wissenspflege: Zustand als Hook, Kurztext für die Warteschlangen-Pille und Abschnitt darin (Countdown mit offener
// Arbeit oder Lauf mit Fortschritt; Abbrechen lässt sie zwei Stunden ruhen, im Countdown geht auch Jetzt starten)
import { useEffect, useState } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";

export interface MaintenanceState {
  status: "idle" | "countdown" | "running" | "snoozed";
  until?: number;
  open: { extract?: number; chunks: number; chunkDocs: number; chapters: number; chapterDocs: number; words?: number };
  phase?: "docling" | "embeddings" | "concepts" | "pron";
  doc?: string;
  detail?: string;
  done: number;
  total: number;
}

export const maintenanceActive = (st: MaintenanceState | null): boolean => !!st && (st.status === "countdown" || st.status === "running");

export function useMaintenance(): { st: MaintenanceState | null; now: number; act: (path: "start" | "cancel") => Promise<void> } {
  const [st, setSt] = useState<MaintenanceState | null>(null);
  const [now, setNow] = useState(Date.now());
  const active = maintenanceActive(st);
  useEffect(() => {
    const load = () => void request<MaintenanceState>("/api/maintenance").then(setSt).catch(() => undefined);
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
  const act = async (path: "start" | "cancel") => setSt(await request<MaintenanceState>(`/api/maintenance/${path}`, { method: "POST" }));
  return { st, now, act };
}

const secsLeft = (st: MaintenanceState, now: number) => Math.max(0, Math.round(((st.until ?? now) - now) / 1000));

export function maintenancePill(st: MaintenanceState, now: number): string {
  if (st.status === "countdown") {
    const secs = secsLeft(st, now);
    return secs > 0 ? t("maintenance.pillCountdown", { s: secs }) : t("maintenance.pillWaiting");
  }
  return `${t("maintenance.pillRunning", { phase: st.phase ? t(`maintenance.short.${st.phase}`) : "" })}${st.total ? ` · ${st.done}/${st.total}` : ""}`;
}

// Stand ohne den Namen, für die Überschrift des Abschnitts
export function maintenanceStatus(st: MaintenanceState, now: number): string {
  if (st.status === "countdown") {
    const secs = secsLeft(st, now);
    return secs > 0 ? t("maintenance.statusCountdown", { s: secs }) : t("maintenance.statusWaiting");
  }
  return `${st.phase ? t(`maintenance.short.${st.phase}`) : ""}${st.total ? ` · ${st.done}/${st.total}` : ""}`;
}

export function MaintenanceSection({ st, now, act }: { st: MaintenanceState; now: number; act: (path: "start" | "cancel") => Promise<void> }) {
  const secs = secsLeft(st, now);
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold">
        {t("maintenance.title")} <span className="font-normal text-neutral-500">· {maintenanceStatus(st, now)}</span>
      </div>
      {st.status === "countdown" ? (
        <>
          <p className="text-xs text-neutral-500">{secs > 0 ? t("maintenance.countdownHint", { s: secs }) : t("maintenance.waitingHint")}</p>
          <ul className="text-xs text-neutral-500 flex flex-col gap-1">
            {!!st.open.extract && <li>{t("maintenance.openExtract", { n: st.open.extract })}</li>}
            {st.open.chunks > 0 && <li>{t("maintenance.openChunks", { docs: st.open.chunkDocs, n: st.open.chunks })}</li>}
            {st.open.chapters > 0 && <li>{t("maintenance.openChapters", { docs: st.open.chapterDocs, n: st.open.chapters })}</li>}
            {!!st.open.words && <li>{t("maintenance.openWords", { n: st.open.words })}</li>}
          </ul>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="text-sm">{st.phase ? t(`maintenance.phase.${st.phase}`) : ""}</div>
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
  );
}
