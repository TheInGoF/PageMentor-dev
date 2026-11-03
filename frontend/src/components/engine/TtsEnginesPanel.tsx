// Stimmen-Engines: Kokoro fest, Qwen, F5 und TADA wählbar; HF-Token für TADA
import { useEffect, useState } from "react";
import { api, type TtsEnginesInfo } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { Card, SettingRow } from "../settings/parts";

export function TtsEnginesPanel() {
  const toast = useToast();
  const [info, setInfo] = useState<TtsEnginesInfo | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  // Klangstufen als Entwurf: gespeichert wird alles zusammen mit „Übernehmen“
  type Q = "fast" | "calm" | "best";
  const [quality, setQuality] = useState<{ tada: Q; f5: Q }>({ tada: "calm", f5: "calm" });
  const [qwenBatch, setQwenBatch] = useState(1);

  useEffect(() => {
    api.engine
      .ttsEngines()
      .then((i) => {
        setInfo(i);
        setEnabled(i.enabled);
        setQuality({ tada: i.quality?.tada ?? "calm", f5: i.quality?.f5 ?? "calm" });
        setQwenBatch(i.qwenBatch ?? 1);
      })
      .catch(() => {});
  }, []);

  if (!info) return null;

  const toggle = (id: string) => setEnabled((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));
  const needsToken = enabled.includes("tada") && !info.hfTokenPresent && !token.trim();
  const savedQ = { tada: info.quality?.tada ?? "calm", f5: info.quality?.f5 ?? "calm" };
  const qualityChanged = quality.tada !== savedQ.tada || quality.f5 !== savedQ.f5;
  const enginesChanged = enabled.join(",") !== info.enabled.join(",") || !!token.trim();
  const batchChanged = qwenBatch !== (info.qwenBatch ?? 1);
  const changed = enginesChanged || qualityChanged || batchChanged;

  async function save() {
    setSaving(true);
    try {
      // Klangstufen gelten sofort, ohne Neustart der Engine
      for (const e of ["tada", "f5"] as const) if (quality[e] !== savedQ[e]) await api.engine.setQuality(e, quality[e]);
      if (batchChanged) await api.engine.setQwenBatch(qwenBatch);
      let applying = false;
      let nextEnabled = info!.enabled;
      if (enginesChanged) {
        const r = await api.engine.saveTtsEngines(enabled, token.trim() || undefined);
        applying = !!r.applying;
        nextEnabled = r.enabled;
      }
      setInfo({ ...info!, enabled: nextEnabled, hfTokenPresent: info!.hfTokenPresent || !!token.trim(), quality, qwenBatch });
      setToken("");
      toast.show(applying ? t("ttsEngines.applying") : t("ttsEngines.saved"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={t("ttsEngines.title")}>
      <p className="text-xs text-neutral-500">{t("ttsEngines.hint")}</p>
      <SettingRow label={t("ttsEngines.kokoroFixed")}>
        <span className="text-xs text-neutral-500">{t("ttsEngines.always")}</span>
      </SettingRow>
      {Object.entries(info.engines).map(([id, e]) => (
        <SettingRow key={id} label={`${e.title} · ~${e.sizeGb} GB`} hint={t(`ttsEngines.${id}`)}>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={enabled.includes(id)} onChange={() => toggle(id)} />
            {t("settings.abs.enableShort")}
          </label>
        </SettingRow>
      ))}
      {(["f5", "tada"] as const)
        .filter((e) => enabled.includes(e) && info.enabled.includes(e))
        .map((e) => {
          const q = quality[e];
          return (
            <SettingRow key={e} label={t(`ttsEngines.quality.${e}`)} hint={t(`ttsEngines.quality.${e}.${q}Hint`)}>
              <select
                className="input w-full"
                value={q}
                onChange={(ev) => setQuality({ ...quality, [e]: ev.target.value as Q })}
              >
                {(["fast", "calm", "best"] as const).map((x) => (
                  <option key={x} value={x}>
                    {t(`ttsEngines.quality.${e}.${x}`)}
                  </option>
                ))}
              </select>
            </SettingRow>
          );
        })}
      {enabled.includes("qwen") && info.enabled.includes("qwen") && (
        <SettingRow label={t("ttsEngines.qwenBatch")} hint={t(qwenBatch > 1 ? "ttsEngines.qwenBatchOnHint" : "ttsEngines.qwenBatchHint")}>
          <select className="input w-full" value={qwenBatch} onChange={(ev) => setQwenBatch(Number(ev.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? t("ttsEngines.qwenBatchOff") : t("ttsEngines.qwenBatchN", { n })}
              </option>
            ))}
          </select>
        </SettingRow>
      )}
      {enabled.includes("tada") && (
        <div className="flex flex-col gap-2">
          <label className="text-xs text-neutral-400">
            {t("ttsEngines.hfToken")} {info.hfTokenPresent && <span className="text-neutral-500">· {t("ttsEngines.hfTokenSet")}</span>}
          </label>
          <input className="input" type="password" value={token} placeholder="hf_…" onChange={(e) => setToken(e.target.value)} />
          <p className="text-xs text-neutral-500">{t("ttsEngines.hfTokenHint")}</p>
        </div>
      )}
      <div>
        <Button onClick={save} disabled={saving || !changed || needsToken}>
          {t("ttsEngines.save")}
        </Button>
      </div>
    </Card>
  );
}
