// Sprachmodelle: Gemma e4b fest für Hörbuch und Begriffsnetz, größere Modelle zum Dazuladen für den Tutor
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { LlmModelsInfo } from "../../lib/api/engine";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { Card, SettingRow } from "../settings/parts";

// "Gemma 4 26B · 24k Kontext · 20 Quellen": was in den Kontext des Modells passt
const budgetLabel = (name: string, b: { ctx: number; hits: number }) => `${name} · ${t("llmModels.budget", { ctx: Math.round(b.ctx / 1024), hits: b.hits })}`;

export function LlmModelsPanel() {
  const toast = useToast();
  const [info, setInfo] = useState<LlmModelsInfo | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [tutor, setTutor] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.engine
      .llmModels()
      .then((i) => {
        setInfo(i);
        setEnabled(i.enabled);
        setTutor(i.tutorModel);
      })
      .catch(() => {});
  }, []);

  if (!info) return null;
  const toggle = (id: string) => {
    const next = enabled.includes(id) ? enabled.filter((e) => e !== id) : [...enabled, id];
    setEnabled(next);
    if (!next.includes(tutor)) setTutor(next[0] ?? "");
  };
  const changed = enabled.join(",") !== info.enabled.join(",") || tutor !== info.tutorModel;
  const removing = info.enabled.filter((m) => !enabled.includes(m));

  async function save() {
    if (removing.length && !confirm(t("llmModels.removeConfirm", { names: removing.map((m) => info!.models[m]?.title ?? m).join(", ") }))) return;
    setSaving(true);
    try {
      const r = await api.engine.saveLlmModels(enabled, tutor);
      setInfo({ ...info!, enabled: r.enabled, tutorModel: r.tutorModel });
      toast.show(r.pulling ? t("llmModels.pulling") : t("ttsEngines.saved"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={t("llmModels.title")}>
      <p className="text-xs text-neutral-500">{t("llmModels.hint")}</p>
      <SettingRow label={info.defaultModel} hint={t("llmModels.defaultHint")}>
        <span className="text-xs text-neutral-500">{t("ttsEngines.always")}</span>
      </SettingRow>
      {Object.entries(info.models).map(([id, m]) => (
        <SettingRow
          key={id}
          label={`${m.title} · ~${m.sizeGb} GB`}
          hint={`${t(`llmModels.${id.split(":")[0].replace(".", "")}`)}${info.installed?.includes(id) ? ` · ${t("llmModels.installed")}` : enabled.includes(id) ? ` · ${t("llmModels.missing")}` : ""}`}
        >
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="w-5 h-5" checked={enabled.includes(id)} onChange={() => toggle(id)} />
            {t("settings.abs.enableShort")}
          </label>
        </SettingRow>
      ))}
      <SettingRow label={t("llmModels.tutor")} hint={t("llmModels.tutorHint")}>
        <select className="input w-full" value={tutor} onChange={(e) => setTutor(e.target.value)}>
          <option value="">{budgetLabel(info.defaultModel, info.defaultBudget)}</option>
          {enabled.map((id) => (
            <option key={id} value={id}>
              {info.models[id] ? budgetLabel(info.models[id].title, info.models[id]) : id}
            </option>
          ))}
        </select>
      </SettingRow>
      <div>
        <Button onClick={save} disabled={saving || !changed}>
          {t("ttsEngines.save")}
        </Button>
      </div>
    </Card>
  );
}
