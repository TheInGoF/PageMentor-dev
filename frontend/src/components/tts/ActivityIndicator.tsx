// Eine Pille für alles, was auf der Grafikkarte läuft oder wartet. Die Pille nennt das Laufende und wie viel wartet;
// Klick klappt die Übersicht auf: oben die Hauptwarteschlange (Umwandlung, Hörbuch, Lernhörbuch) mit ↑ ↓ und ⋯ zum
// Entfernen, danach der Hörbuch-Stapel mit seinen Büchern und die Wissenspflege mit ihren Knöpfen. Nach einem
// Neustart steht die unterbrochene Warteschlange mit Fortsetzen und Verwerfen vorn
import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { move } from "../../lib/move";
import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";
import { batchActive, batchFinished, batchPill, BatchFinishedModal, BatchSection, useBatch } from "../batch/BatchIndicator";
import { maintenanceActive, maintenancePill, MaintenanceSection, useMaintenance } from "../maintenance/MaintenanceIndicator";

export interface ActivityItem {
  kind: "docling" | "import" | "learnbook" | "audiobook" | "batch" | "maintenance" | "concepts" | "tts" | "proncheck";
  status: "running" | "waiting";
  title: string;
  step?: string;
  detail?: string;
  done?: number;
  total?: number;
  docId?: string;
  sub?: string;
  learnKind?: "subject" | "language";
  ticket?: string;
  movable?: boolean;
}
// Nach dem Neustart offen, bis Fortsetzen oder Verwerfen
interface PausedEntry {
  kind: "docling" | "audiobook" | "learnbook";
  docId: string;
  title: string;
}
type Answer = { items: ActivityItem[]; paused: PausedEntry[] };

const ENGINE: Record<string, string> = { f5: "F5", qwen: "Qwen", kokoro: "Kokoro", tada: "TADA" };
// Stapel und Wissenspflege haben eigene Abschnitte mit Steuerung; in der Liste stehen sie nicht noch einmal
const SECTIONED = new Set(["batch", "maintenance"]);
const gb = (b: number) => (b / 1e9).toFixed(1).replace(".", ",");

function count(a: ActivityItem): string {
  if (a.kind === "tts") return a.total ? `${Math.min(99, Math.round(((a.done ?? 0) / a.total) * 100))} %` : "";
  return a.total ? `${Math.min(a.done ?? 0, a.total)}/${a.total}` : "";
}

// Kurzer Text für Pille und Liste
export function activityLabel(a: ActivityItem): string {
  if (a.kind === "tts") {
    const engine = ENGINE[a.title] ?? a.title;
    const model = (a.detail ?? "").replace(/^F5 /, "");
    return t(`activity.tts.${a.step ?? "load"}`, { engine, model });
  }
  const step = a.step ? t(`activity.step.${a.kind}.${a.step}`) : "";
  return t(`activity.kind.${a.kind}`, { step: step.startsWith("activity.") ? "" : step });
}

export function ActivityIndicator() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [paused, setPaused] = useState<PausedEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [batch, setBatch] = useBatch();
  const maint = useMaintenance();
  const ref = useRef<HTMLDivElement>(null);
  const busy = items.length > 0;
  const apply = (r: Answer) => {
    setItems(r.items);
    setPaused(r.paused ?? []);
  };

  useEffect(() => {
    let stop = false;
    const load = () =>
      void request<Answer>("/api/activity")
        .then((r) => !stop && apply(r))
        .catch(() => undefined);
    load();
    const iv = setInterval(load, busy ? 3000 : 8000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [busy]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (batch && batchFinished(batch)) return <BatchFinishedModal batch={batch} setBatch={setBatch} />;
  const queue = items.filter((i) => !SECTIONED.has(i.kind));
  const showBatch = batchActive(batch);
  const showMaint = maintenanceActive(maint.st);
  if (!queue.length && !paused.length && !showBatch && !showMaint) return null;

  // Hauptwarteschlange steuern: Reihenfolge, Eintrag entfernen, Fortsetzen, Verwerfen; Antwort ist die frische Liste
  const post = (path: string, body?: unknown) =>
    void request<Answer>(`/api/activity/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })
      .then(apply)
      .catch(() => undefined);
  const order = queue.filter((i) => i.ticket).map((i) => i.ticket!);
  const shift = (ticket: string, dir: -1 | 1) => post("reorder", { ids: move(order, order.indexOf(ticket), dir) });
  const remove = (a: ActivityItem) => {
    const what = `${activityLabel(a)}${a.title ? ` · ${a.title}` : ""}`;
    if (confirm(t(a.status === "running" ? "activity.removeRunningConfirm" : "activity.removeConfirm", { what }))) post("remove", { id: a.ticket });
  };

  // Pille: erst die Hauptwarteschlange, sonst die Übernahme, sonst Stapel, sonst Wissenspflege
  const lead = queue[0];
  const waiting = items.filter((i) => i.status === "waiting").length;
  const pill = lead
    ? `${activityLabel(lead)}${count(lead) ? ` · ${count(lead)}` : ""}${waiting && lead.status === "running" ? ` · ${t("activity.waitingCount", { n: waiting })}` : ""}`
    : paused.length
      ? t("activity.paused", { n: paused.length })
      : showBatch
        ? batchPill(batch!)
        : maintenancePill(maint.st!, maint.now);
  const pillRunning = lead ? lead.status === "running" : !paused.length && (showBatch ? batch!.status === "running" : maint.st?.status === "running");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "px-2 py-1 rounded-md text-xs border whitespace-nowrap max-w-[22rem] truncate",
          pillRunning ? "border-accent/40 bg-accent/10 text-accent" : "border-amber-500/40 bg-amber-500/10"
        )}
        title={t("activity.title")}
      >
        {pill}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-[min(30rem,92vw)] max-h-[80vh] overflow-y-auto card p-4 flex flex-col gap-4">
          <div className="text-base font-semibold">{t("activity.title")}</div>
          {paused.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="text-sm font-semibold">{t("activity.paused", { n: paused.length })}</div>
              <p className="text-xs text-neutral-500">{t("activity.pausedHint")}</p>
              <ol className="flex flex-col gap-1">
                {paused.map((p, i) => (
                  <li key={`${p.kind}-${p.docId}`} className="text-sm truncate">
                    <span className="text-neutral-500 tabular-nums">{i + 1}. </span>
                    {t(`activity.kind.${p.kind}`, { step: "" }).trim()} · {p.title}
                  </li>
                ))}
              </ol>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => post("discard")}>
                  {t("activity.discard")}
                </Button>
                <Button onClick={() => post("resume")}>{t("activity.resume")}</Button>
              </div>
            </div>
          )}
          {queue.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-neutral-500">{t("activity.hint")}</p>
              <ol className="flex flex-col gap-2">
                {queue.map((a, i) => {
                  const pos = a.ticket ? order.indexOf(a.ticket) : -1;
                  // Nach oben nur hinter dem Eintrag, der die Grafikkarte hält
                  const prev = pos > 0 ? queue.find((x) => x.ticket === order[pos - 1]) : undefined;
                  return (
                    <li key={a.ticket ?? i} className="flex gap-3 items-start">
                      <span className={cn("mt-1 inline-block w-2 h-2 rounded-full shrink-0", a.status === "running" ? "bg-accent" : "bg-amber-500")} aria-hidden />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">
                          {activityLabel(a)}
                          {count(a) && <span className="text-neutral-500 tabular-nums"> · {count(a)}</span>}
                        </div>
                        <div className="text-xs text-neutral-500 truncate">
                          {[
                            a.status === "waiting" ? t("activity.waits") : null,
                            a.kind === "tts" ? null : a.title,
                            a.kind === "tts" ? null : a.detail,
                            a.sub ? t(`activity.sub.${a.sub}`) : null,
                            a.kind === "tts" && a.total ? t("activity.ttsBytes", { done: gb(a.done ?? 0), total: gb(a.total) }) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        {a.total ? (
                          <div className="mt-1 h-1 rounded bg-bg-elevated overflow-hidden">
                            <div className="h-full bg-accent" style={{ width: `${Math.min(100, ((a.done ?? 0) / a.total) * 100)}%` }} />
                          </div>
                        ) : null}
                      </div>
                      {a.ticket && (
                        <div className="flex items-center gap-1 shrink-0">
                          {a.movable && (
                            <>
                              <Button variant="ghost" className="!px-2 !py-1" onClick={() => shift(a.ticket!, -1)} disabled={pos <= 0 || !prev?.movable} aria-label={t("batch.audio.up")} title={t("batch.audio.up")}>
                                ↑
                              </Button>
                              <Button variant="ghost" className="!px-2 !py-1" onClick={() => shift(a.ticket!, 1)} disabled={pos >= order.length - 1} aria-label={t("batch.audio.down")} title={t("batch.audio.down")}>
                                ↓
                              </Button>
                            </>
                          )}
                          <Menu label={t("activity.actions")} items={[{ label: t("activity.remove"), onClick: () => remove(a) }]} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          {showBatch && (
            <div className="border-t border-border pt-3">
              <BatchSection batch={batch!} setBatch={setBatch} />
            </div>
          )}
          {showMaint && (
            <div className="border-t border-border pt-3">
              <MaintenanceSection st={maint.st!} now={maint.now} act={maint.act} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
