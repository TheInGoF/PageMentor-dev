// Optionen vor dem Hörbuch-Lauf: Stimme und Tempo aus den Einstellungen, für diesen Lauf änderbar; Audiobookshelf
import { useEffect, useState } from "react";
import { api, type Voice } from "../../lib/api";
import { getSettings } from "../../lib/settings";
import { t } from "../../lib/i18n";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { RATES } from "../settings/types";
import { SettingRow } from "../settings/parts";

export function AudiobookBatchDialog({ docIds, onClose }: { docIds: string[]; onClose: (started: boolean) => void }) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState(getSettings().defaultVoice);
  const [rate, setRate] = useState(getSettings().defaultRate || "+0%");
  const [absReady, setAbsReady] = useState(false);
  const [abs, setAbs] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void api.audio.voices().then((v) => {
      setVoices(v.voices);
      // Ohne gespeicherte Standardstimme: die erste deutsche
      setVoiceId((cur) => (cur && v.voices.some((x) => x.id === cur) ? cur : v.voices.find((x) => x.language === "de")?.id ?? v.voices[0]?.id ?? ""));
    });
    void api.batch.status().then((r) => setAbsReady(!!r.absReady));
  }, []);

  async function start() {
    setBusy(true);
    try {
      await api.batch.start({ docIds, voiceId, rate, model: getSettings().defaultOllamaModel || undefined, abs: absReady && abs });
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
        <SettingRow label={t("batch.audio.abs")} hint={absReady ? t("batch.audio.absHint") : t("batch.audio.absOff")}>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={absReady && abs} disabled={!absReady} onChange={(e) => setAbs(e.target.checked)} />
            {t("settings.abs.enableShort")}
          </label>
        </SettingRow>
      </div>
    </Modal>
  );
}
