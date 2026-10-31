// Optionen vor dem Hörbuch-Lauf: Stimme und Tempo aus den Einstellungen, für diesen Lauf änderbar; Audiobookshelf
import { useEffect, useState } from "react";
import { api, type Voice } from "../../lib/api";
import { getSettings } from "../../lib/settings";
import { t } from "../../lib/i18n";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { RATES } from "../settings/types";
import { SettingRow, SubTitle } from "../settings/parts";
import { move } from "../../lib/move";

export function AudiobookBatchDialog({ docs, onClose }: { docs: Array<{ id: string; title: string }>; onClose: (started: boolean) => void }) {
  const [list, setList] = useState(docs);
  const [order, setOrder] = useState<"book" | "phase">("book");
  const docIds = list.map((d) => d.id);
  const [voices, setVoices] = useState<Voice[]>([]);
  // Leer = je Buch die Standardstimme seiner Sprache aus den Einstellungen
  const [voiceId, setVoiceId] = useState("");
  const [rate, setRate] = useState(getSettings().defaultRate || "+0%");
  const [absReady, setAbsReady] = useState(false);
  const [abs, setAbs] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void api.audio.voices().then((v) => {
      setVoices(v.voices);
    });
    void api.batch.status().then((r) => setAbsReady(!!r.absReady));
  }, []);

  async function start() {
    setBusy(true);
    try {
      await api.batch.start({ docIds, voiceId, rate, model: getSettings().defaultOllamaModel || undefined, abs: absReady && abs, order });
      toast.show(t("batch.audio.started", { n: docIds.length }), "success");
      onClose(true);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => onClose(false)}
      title={t("batch.audio.title", { n: docIds.length })}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            {t("common.close")}
          </Button>
          <Button onClick={start} disabled={busy || !voiceId}>
            {t("batch.audio.start")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-neutral-500">{t("batch.audio.hint")}</p>
        <SettingRow label={t("settings.defaultVoice")}>
          <select className="input w-full" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            <option value="">{t("voiceDefaults.perLanguage")}</option>
            {voices.map((v) => (
              <option key={v.id + v.language} value={v.id}>
                {v.label} · {t(`audiobook.engine.${v.engine}`)} · {v.language.toUpperCase()}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t("settings.defaultRate")}>
          <select className="input w-full" value={rate} onChange={(e) => setRate(e.target.value)}>
            {RATES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.value === "+0%" ? t("rate.0") : r.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t("batch.audio.order")} hint={t(order === "book" ? "batch.audio.orderBookHint" : "batch.audio.orderPhaseHint")}>
          <select className="input w-full" value={order} onChange={(e) => setOrder(e.target.value as "book" | "phase")}>
            <option value="book">{t("batch.audio.orderBook")}</option>
            <option value="phase">{t("batch.audio.orderPhase")}</option>
          </select>
        </SettingRow>
        <SettingRow label={t("batch.audio.abs")} hint={absReady ? t("batch.audio.absHint") : t("batch.audio.absOff")}>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={absReady && abs} disabled={!absReady} onChange={(e) => setAbs(e.target.checked)} />
            {t("settings.abs.enableShort")}
          </label>
        </SettingRow>
        {list.length > 1 && <OrderList items={list} onMove={(i, dir) => setList((cur) => move(cur, i, dir))} />}
      </div>
    </Modal>
  );
}

// Reihenfolge der Bücher: ↑/↓ je Zeile, auch in der Kopfzeile für wartende Bücher genutzt
export function OrderList({ items, onMove, title = true }: { items: Array<{ id: string; title: string; locked?: boolean }>; onMove: (index: number, dir: -1 | 1) => void; title?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {title && <SubTitle>{t("batch.audio.sequence")}</SubTitle>}
      <ol className="flex flex-col divide-y divide-border">
        {items.map((d, i) => (
          <li key={d.id} className="flex items-center gap-2 py-1">
            <span className="w-6 text-right text-xs text-neutral-500 tabular-nums">{i + 1}</span>
            <span className="flex-1 min-w-0 text-sm truncate">{d.title}</span>
            {!d.locked && (
              <>
                <Button variant="ghost" className="!px-2 !py-1" onClick={() => onMove(i, -1)} disabled={i === 0 || !!items[i - 1]?.locked} aria-label={t("batch.audio.up")} title={t("batch.audio.up")}>
                  ↑
                </Button>
                <Button variant="ghost" className="!px-2 !py-1" onClick={() => onMove(i, 1)} disabled={i === items.length - 1} aria-label={t("batch.audio.down")} title={t("batch.audio.down")}>
                  ↓
                </Button>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
