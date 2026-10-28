// Stimmen-Engines: Kokoro fest, Qwen, F5 und TADA wählbar; HF-Token für TADA
import { useEffect, useState } from "react";
import { api, type TtsEnginesInfo } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { Card } from "../settings/parts";

export function TtsEnginesPanel() {
  const toast = useToast();
  const [info, setInfo] = useState<TtsEnginesInfo | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.engine
      .ttsEngines()
      .then((i) => {
        setInfo(i);
        setEnabled(i.enabled);
      })
      .catch(() => {});
  }, []);

  if (!info) return null;

  const toggle = (id: string) => setEnabled((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));
  const needsToken = enabled.includes("tada") && !info.hfTokenPresent && !token.trim();
  const changed = enabled.join(",") !== info.enabled.join(",") || !!token.trim();

  async function save() {
    setSaving(true);
    try {
      const r = await api.engine.saveTtsEngines(enabled, token.trim() || undefined);
      setInfo({ ...info!, enabled: r.enabled, hfTokenPresent: info!.hfTokenPresent || !!token.trim() });
      setToken("");
      toast.show(r.applying ? t("ttsEngines.applying") : t("ttsEngines.saved"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={t("ttsEngines.title")}>
      <p className="text-xs text-neutral-500">{t("ttsEngines.hint")}</p>
      <div className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked disabled />
        <span className="flex-1">{t("ttsEngines.kokoroFixed")}</span>
        <span className="text-xs text-neutral-500">{t("ttsEngines.always")}</span>
      </div>
      {Object.entries(info.engines).map(([id, e]) => (
        <label key={id} className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={enabled.includes(id)} onChange={() => toggle(id)} />
          <span className="flex flex-col">
            <span className="text-sm">
              {e.title} <span className="text-xs text-neutral-500">· ~{e.sizeGb} GB</span>
            </span>
            <span className="text-xs text-neutral-500">{t(`ttsEngines.${id}`)}</span>
          </span>
        </label>
      ))}
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
