// Download-Bremse: Anteil der gemessenen Leitungsrate wählen, Messwert anzeigen, neu messen
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { ThrottleInfo } from "../../lib/api/engine";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { Card, Notice, SettingRow } from "../settings/parts";

const STEPS = [50, 60, 70, 80, 90, 100];

export function DownloadLimitPanel() {
  const toast = useToast();
  const [info, setInfo] = useState<ThrottleInfo | null>(null);

  useEffect(() => {
    const load = () => api.engine.throttle().then(setInfo).catch(() => undefined);
    void load();
    // Während einer Messung den Stand nachziehen
    const iv = setInterval(() => void load(), 10_000);
    return () => clearInterval(iv);
  }, []);

  if (!info) return null;
  const save = async (body: { pct?: number; remeasure?: boolean }) => {
    try {
      setInfo(await api.engine.setThrottle(body));
      if (body.remeasure) toast.show(t("download.remeasured"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  };
  const steps = STEPS.includes(info.pct) ? STEPS : [...STEPS, info.pct].sort((a, b) => a - b);

  return (
    <Card title={t("download.title")} status={info.measuring ? t("download.measuring") : undefined}>
      <p className="text-xs text-neutral-500">{t("download.hint")}</p>
      <SettingRow label={t("download.pct")} hint={t("download.pctHint")}>
        <select className="input w-full" value={info.pct} onChange={(e) => void save({ pct: Number(e.target.value) })}>
          {steps.map((p) => (
            <option key={p} value={p}>
              {p === 100 ? t("download.off") : `${p} %`}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label={t("download.measured")}
        hint={info.maxMbit ? t("download.measuredValue", { max: info.maxMbit, limit: info.limitMbit ?? "–" }) : t("download.notMeasured")}
      >
        <Button variant="outline" disabled={!info.maxMbit || info.measuring} onClick={() => void save({ remeasure: true })}>
          {t("download.remeasure")}
        </Button>
      </SettingRow>
      {!info.windows && <Notice>{t("download.windowsOnly")}</Notice>}
      {info.error && <Notice kind="warn">{info.error}</Notice>}
    </Card>
  );
}
