// Hörbuch-Stapel: Zustand als Hook, Abschnitt für die Warteschlangen-Pille (Bücher mit Schritt, Umsortieren,
// Fortsetzen nach Neustart, Abbrechen) und der Abschluss als Fenster mit Feuerwerk
import { useEffect, useState } from "react";
import { api, type AudiobookBatch } from "../../lib/api";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Fireworks } from "./Fireworks";
import { move } from "../../lib/move";

export function useBatch(): [AudiobookBatch | null, (b: AudiobookBatch | null) => void] {
  const [batch, setBatch] = useState<AudiobookBatch | null>(null);
  const running = batch?.status === "running";
  useEffect(() => {
    const load = () => void api.batch.status().then((r) => setBatch(r.batch)).catch(() => undefined);
    load();
    const iv = setInterval(load, running ? 3000 : 15000);
    return () => clearInterval(iv);
  }, [running]);
  return [batch, setBatch];
}

export const batchActive = (b: AudiobookBatch | null): boolean => !!b && (b.status === "running" || b.status === "paused");
export const batchFinished = (b: AudiobookBatch | null): boolean => !!b && (b.status === "done" || b.status === "canceled");

// Kurztext: „Hörbücher 1/2 · Kapitel 3/7“ bzw. „Hörbuch-Lauf unterbrochen“
export function batchPill(batch: AudiobookBatch): string {
  if (batch.status === "paused") return t("batch.audio.paused");
  const doneCount = batch.items.filter((i) => i.step === "done").length;
  const pos = Math.min(batch.items.length, doneCount + 1);
  const c = batch.current;
  return `${t("batch.audio.pill", { i: pos, n: batch.items.length })}${c && c.chapters ? ` · ${t("batch.audio.chapter", { i: c.chapter, n: c.chapters })}` : ""}`;
}

type Act = (fn: () => Promise<{ batch: AudiobookBatch | null }>) => Promise<void>;

// Abschluss: Fenster mit Zusammenfassung, bei Erfolg mit Feuerwerk
export function BatchFinishedModal({ batch, setBatch }: { batch: AudiobookBatch; setBatch: (b: AudiobookBatch | null) => void }) {
  const doneCount = batch.items.filter((i) => i.step === "done").length;
  const act: Act = async (fn) => setBatch((await fn()).batch);
  return (
    <Modal
      open
      onClose={() => void act(api.batch.dismiss)}
      title={batch.status === "canceled" ? t("batch.audio.canceledTitle") : doneCount ? t("batch.audio.doneTitle") : t("batch.audio.endedTitle")}
      footer={<Button onClick={() => void act(api.batch.dismiss)}>{t("common.close")}</Button>}
    >
      <div className="flex flex-col gap-4">
        {batch.status === "done" && doneCount > 0 && <Fireworks />}
        <p className="text-sm">{t("batch.audio.summary", { ok: doneCount, n: batch.items.length })}</p>
        <ItemList batch={batch} />
      </div>
    </Modal>
  );
}

// Abschnitt in der Warteschlangen-Pille: Bücher mit Schritt, wartende verschiebbar, Steuerung unten
export function BatchSection({ batch, setBatch }: { batch: AudiobookBatch; setBatch: (b: AudiobookBatch | null) => void }) {
  const act: Act = async (fn) => setBatch((await fn()).batch);
  const paused = batch.status === "paused";
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-semibold">
        {t("activity.sectionBatch")} <span className="font-normal text-neutral-500">· {batchPill(batch)}</span>
      </div>
      {paused && <p className="text-xs text-neutral-500">{t("batch.audio.pausedHint")}</p>}
      <ItemList batch={batch} onReorder={(ids) => void act(() => api.batch.reorder(ids))} />
      <div className="flex gap-2 justify-end">
        {paused ? (
          <>
            <Button variant="ghost" onClick={() => void api.batch.cancel().then(() => act(api.batch.dismiss))}>
              {t("batch.audio.discard")}
            </Button>
            <Button onClick={() => void act(api.batch.resume)}>{t("batch.audio.resume")}</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => confirm(t("batch.audio.cancelConfirm")) && void act(api.batch.cancel)}>
            {t("batch.audio.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}

const DOT: Record<string, string> = {
  wait: "bg-neutral-400",
  docling: "bg-amber-400 animate-pulse",
  audio: "bg-amber-400 animate-pulse",
  abs: "bg-amber-400 animate-pulse",
  done: "bg-emerald-500",
  failed: "bg-red-500",
  canceled: "bg-neutral-400",
};

// onReorder: wartende Bücher lassen sich verschieben, laufende und fertige nicht
function ItemList({ batch, onReorder }: { batch: AudiobookBatch; onReorder?: (waitingIds: string[]) => void }) {
  const waiting = batch.items.filter((i) => i.step === "wait").map((i) => i.docId);
  const shift = (docId: string, dir: -1 | 1) => onReorder?.(move(waiting, waiting.indexOf(docId), dir));
  return (
    <ul className="flex flex-col divide-y divide-border max-h-[40vh] overflow-y-auto">
      {batch.items.map((i) => {
        const c = batch.current?.docId === i.docId ? batch.current : null;
        return (
          <li key={i.docId} className="flex items-center gap-4 py-2">
            <span className={cn("w-2 h-2 rounded-full shrink-0", DOT[i.step])} />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{i.title}</div>
              <div className="text-xs text-neutral-500 truncate">
                {t(`batch.step.${i.step}`)}
                {c && c.chapters ? ` · ${t("batch.audio.chapter", { i: c.chapter, n: c.chapters })}${c.chunks ? ` · ${c.chunk}/${c.chunks}` : ""}` : ""}
                {i.error ? ` · ${i.error}` : i.note ? ` · ${i.note}` : ""}
              </div>
            </div>
            {onReorder && i.step === "wait" && waiting.length > 1 && (
              <span className="flex shrink-0">
                <Button variant="ghost" className="!px-2 !py-1" disabled={waiting[0] === i.docId} onClick={() => shift(i.docId, -1)} aria-label={t("batch.audio.up")} title={t("batch.audio.up")}>
                  ↑
                </Button>
                <Button variant="ghost" className="!px-2 !py-1" disabled={waiting[waiting.length - 1] === i.docId} onClick={() => shift(i.docId, 1)} aria-label={t("batch.audio.down")} title={t("batch.audio.down")}>
                  ↓
                </Button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
