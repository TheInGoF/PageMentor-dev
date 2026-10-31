// Warteschlange im Kopf: was gerade läuft (Lernhörbuch, Umwandlung, Hörbuch, Stimm-Engine lädt …) und was wartet.
// Die Pille nennt das Laufende und wie viel wartet; Klick klappt die ganze Liste auf. Stapel und Wissenspflege
// haben eigene Pillen mit Steuerung, sie stehen nur in der Liste
import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";

export interface ActivityItem {
  kind: "docling" | "import" | "learnbook" | "audiobook" | "batch" | "maintenance" | "concepts" | "tts";
  status: "running" | "waiting";
  title: string;
  step?: string;
  detail?: string;
  done?: number;
  total?: number;
  docId?: string;
}

const ENGINE: Record<string, string> = { f5: "F5", qwen: "Qwen", kokoro: "Kokoro", tada: "TADA" };
const OWN_PILL = new Set(["batch", "maintenance"]);
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const busy = items.length > 0;

  useEffect(() => {
    let stop = false;
    const load = () =>
      void request<{ items: ActivityItem[] }>("/api/activity")
        .then((r) => !stop && setItems(r.items))
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

  const own = items.filter((i) => !OWN_PILL.has(i.kind));
  if (!own.length) return null;
  const first = own[0];
  const waiting = items.filter((i) => i.status === "waiting").length;
  const pill = `${activityLabel(first)}${count(first) ? ` · ${count(first)}` : ""}${waiting && first.status === "running" ? ` · ${t("activity.waitingCount", { n: waiting })}` : ""}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "px-2 py-1 rounded-md text-xs border whitespace-nowrap max-w-[22rem] truncate",
          first.status === "running" ? "border-accent/40 bg-accent/10 text-accent" : "border-amber-500/40 bg-amber-500/10"
        )}
        title={t("activity.title")}
      >
        {pill}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-[min(28rem,92vw)] card p-4 flex flex-col gap-3">
          <div className="text-base font-semibold">{t("activity.title")}</div>
          <p className="text-xs text-neutral-500">{t("activity.hint")}</p>
          <ol className="flex flex-col gap-2">
            {items.map((a, i) => (
              <li key={i} className="flex gap-3 items-start">
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
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
