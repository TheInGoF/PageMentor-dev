// Update aus der App: Version, neuestes Release, aktualisieren
import { useEffect, useState } from "react";
import { api, type UpdateInfo } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Card, Notice, SettingRow } from "./parts";

export function UpdateSection() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const busy = info?.phase === "downloading" || info?.phase === "installing";

  useEffect(() => {
    void api.update.check().then(setInfo).catch(() => undefined);
  }, []);
  // Während des Ladens den Fortschritt abfragen
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => void api.update.progress().then(setInfo).catch(() => undefined), 1000);
    return () => clearInterval(id);
  }, [busy]);

  if (!info) return null;
  const status = info.newer ? t("update.available", { v: info.latest ?? "" }) : info.latest ? t("update.current") : undefined;
  return (
    <Card title={t("update.title")} status={status}>
      <SettingRow label={t("update.version", { v: info.current })} hint={info.latest ? t("update.latest", { v: info.latest }) : t("update.offline")}>
        {info.newer && info.canInstall ? (
          <Button className="w-full" onClick={() => void api.update.install().then(setInfo)} disabled={busy}>
            {info.phase === "downloading"
              ? t("update.downloading", { pct: String(Math.round((info.fraction ?? 0) * 100)) })
              : info.phase === "installing"
                ? t("update.installing")
                : t("update.install")}
          </Button>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => void api.update.check(true).then(setInfo)}>
            {t("update.check")}
          </Button>
        )}
      </SettingRow>
      {info.newer && !info.canInstall && info.releaseUrl && (
        <Notice action={<a className="text-sm text-accent" href={info.releaseUrl} target="_blank" rel="noreferrer">{t("update.open")}</a>}>{t("update.manual")}</Notice>
      )}
      {info.phase === "error" && <Notice kind="error">{info.error}</Notice>}
    </Card>
  );
}
