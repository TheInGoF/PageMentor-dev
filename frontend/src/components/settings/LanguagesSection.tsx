// Sprachen je Stimmen-Engine: Kokoro lädt Englisch und Spanisch auf Knopfdruck, Qwen kann sie schon
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { KokoroPack } from "../../lib/api/engine";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Card, Notice, SettingRow } from "./parts";

export function LanguagesSection({ qwenOn, onEngines }: { qwenOn: boolean; onEngines: () => void }) {
  const [pack, setPack] = useState<KokoroPack | null>(null);
  const downloading = !!pack?.downloading;

  useEffect(() => {
    const load = () => void api.engine.kokoroPack().then(setPack).catch(() => undefined);
    load();
    if (!downloading) return;
    const iv = setInterval(load, 2000);
    return () => clearInterval(iv);
  }, [downloading]);

  return (
    <Card title={t("lang.title")}>
      <p className="text-xs text-neutral-500">{t("lang.hint")}</p>
      <SettingRow
        label={t("lang.kokoro")}
        hint={pack?.installed ? t("lang.kokoroReady") : downloading ? t("lang.downloading", { pct: Math.round((pack?.fraction ?? 0) * 100) }) : t("lang.kokoroHint")}
      >
        <Button variant="outline" className="w-full" disabled={!pack?.available || pack.installed || downloading} onClick={async () => setPack(await api.engine.installKokoroPack())}>
          {pack?.installed ? t("lang.installed") : downloading ? `${Math.round((pack?.fraction ?? 0) * 100)} %` : t("lang.install")}
        </Button>
      </SettingRow>
      {pack?.error && !downloading && <Notice kind="error">{pack.error}</Notice>}
      <SettingRow label={t("lang.qwen")} hint={qwenOn ? t("lang.qwenReady") : t("lang.qwenOff")}>
        {qwenOn ? (
          <span className="text-xs text-neutral-500">{t("lang.builtin")}</span>
        ) : (
          <Button variant="ghost" className="w-full" onClick={onEngines}>
            {t("voices.own.toEngines")}
          </Button>
        )}
      </SettingRow>
      <SettingRow label={t("lang.clone")} hint={t("lang.cloneHint")}>
        <span className="text-xs text-neutral-500">{t("lang.germanOnly")}</span>
      </SettingRow>
    </Card>
  );
}
