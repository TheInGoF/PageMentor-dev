// Hörbuch-Lauf in der Kopfzeile: kleine Anzeige, Klick klappt die Bücher mit ihrem Schritt aus.
// Unterbrochen (nach Neustart): erst nach Bestätigung weiter. Fertig: Abschluss mit Feuerwerk.
import { useEffect, useRef, useState } from "react";
import { api, type AudiobookBatch } from "../../lib/api";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Fireworks } from "./Fireworks";

function useBatch(): [AudiobookBatch | null, (b: AudiobookBatch | null) => void] {
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

export function BatchIndicator() {
  const [batch, setBatch] = useBatch();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!batch) return null;
  const doneCount = batch.items.filter((i) => i.step === "done").length;
  const finished = batch.status === "done" || batch.status === "canceled";
  const act = async (fn: () => Promise<{ batch: AudiobookBatch | null }>) => setBatch((await fn()).batch);

  if (finished) {
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

  const paused = batch.status === "paused";
  const pos = Math.min(batch.items.length, doneCount + 1);
  const c = batch.current;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn("px-2 py-1 rounded-md text-xs border whitespace-nowrap", paused ? "border-amber-500/40 bg-amber-500/10" : "border-accent/40 bg-accent/10 text-accent")}
      >
        {paused
          ? t("batch.audio.paused")
          : `${t("batch.audio.pill", { i: pos, n: batch.items.length })}${c && c.chapters ? ` · ${t("batch.audio.chapter", { i: c.chapter, n: c.chapters })}` : ""}`}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 w-[min(28rem,90vw)] card p-4 flex flex-col gap-4">
          {paused && <p className="text-sm">{t("batch.audio.pausedHint")}</p>}
          <ItemList batch={batch} />
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
      )}
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

function ItemList({ batch }: { batch: AudiobookBatch }) {
  return (
    <ul className="flex flex-col divide-y divide-border max-h-[50vh] overflow-y-auto">
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
          </li>
        );
      })}
    </ul>
  );
}
