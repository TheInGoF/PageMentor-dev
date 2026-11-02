// Zugriff aus dem Heimnetz: Schalter, Passwort, Adressen für andere Geräte, Firewall-Freigabe
import { useEffect, useState } from "react";
import { api, type LanInfo } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Card, Notice, SettingRow } from "./parts";

export function NetworkSection() {
  const [info, setInfo] = useState<LanInfo | null>(null);
  const [local, setLocal] = useState(true);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.auth.check().then((r) => setLocal(r.local)).catch(() => {});
    void api.lan.get().then(setInfo).catch(() => setInfo(null));
  }, []);

  async function save(body: { enabled?: boolean; password?: string }) {
    setBusy(true);
    setMsg(null);
    try {
      setInfo(await api.lan.put(body));
      setPassword("");
      // Der Server bindet sich kurz nach der Antwort neu; Stand danach nachladen
      if (body.enabled !== undefined) setTimeout(() => void api.lan.get().then(setInfo).catch(() => {}), 1500);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function allowFirewall() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.lan.firewall();
      if (!r.ok) setMsg(r.error ?? "?");
      setInfo((i) => (i ? { ...i, firewall: r.firewall } : i));
    } finally {
      setBusy(false);
    }
  }

  function copy(url: string) {
    void navigator.clipboard?.writeText(url).then(() => setCopied(url));
  }

  if (!local) {
    return (
      <Card title={t("lan.title")}>
        <Notice>{t("lan.localOnly")}</Notice>
      </Card>
    );
  }
  if (!info) return null;
  const port = String(info.port);
  const firewallText = info.firewall === null ? t("lan.firewall.unknown") : t(info.firewall ? "lan.firewall.ok" : "lan.firewall.missing", { port });

  return (
    <Card title={t("lan.title")} status={t(info.enabled ? "lan.on" : "lan.off")}>
      <SettingRow label={t("lan.enable")} hint={t("lan.enableHint", { port })}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={info.enabled}
            disabled={busy}
            onChange={(e) => (e.target.checked && !info.passwordSet ? setMsg(t("lan.needPassword")) : void save({ enabled: e.target.checked }))}
          />
          {t(info.enabled ? "lan.on" : "lan.off")}
        </label>
      </SettingRow>
      <SettingRow label={`${t("lan.password")} · ${t(info.passwordSet ? "lan.passwordSet" : "lan.passwordMissing")}`} hint={t("lan.passwordHint")}>
        <div className="flex gap-2">
          <input className="input w-full" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button variant="outline" disabled={busy || !password.trim()} onClick={() => void save({ password })}>
            {t("lan.save")}
          </Button>
        </div>
      </SettingRow>
      {info.enabled && (
        <SettingRow label={t("lan.addresses")} hint={t("lan.addressesHint")}>
          <ul className="flex flex-col gap-1">
            {info.addresses.map((url) => (
              <li key={url} className="flex items-center gap-2 text-sm">
                <code className="flex-1 truncate">{url}</code>
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => copy(url)}>
                  {copied === url ? t("lan.copied") : t("lan.copy")}
                </button>
              </li>
            ))}
          </ul>
        </SettingRow>
      )}
      {info.enabled && info.firewall !== null && (
        <SettingRow label={`${t("lan.firewall")} · ${firewallText}`} hint={t("lan.firewall.hint")}>
          {!info.firewall && (
            <Button variant="outline" disabled={busy} onClick={() => void allowFirewall()}>
              {t("lan.firewall.allow")}
            </Button>
          )}
        </SettingRow>
      )}
      {info.fixedHost && <Notice kind="warn">{t("lan.fixedHost")}</Notice>}
      {msg && <Notice kind="error">{msg}</Notice>}
    </Card>
  );
}
