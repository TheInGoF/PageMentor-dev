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
  const [learnLang, setLearnLang] = useState("");
  const [learnSubject, setLearnSubject] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.engine
      .llmModels()
      .then((i) => {
        setInfo(i);
        setEnabled(i.enabled);
        setTutor(i.tutorModel);
        setLearnLang(i.learnModelLanguage);
        setLearnSubject(i.learnModelSubject);
      })
      .catch(() => {});
  }, []);

  if (!info) return null;
  const toggle = (id: string) => {
    const next = enabled.includes(id) ? enabled.filter((e) => e !== id) : [...enabled, id];
    setEnabled(next);
    if (!next.includes(tutor)) setTutor(next[0] ?? "");
    if (!next.includes(learnLang)) setLearnLang("");
    if (!next.includes(learnSubject)) setLearnSubject("");
  };
  const changed =
    enabled.join(",") !== info.enabled.join(",") || tutor !== info.tutorModel || learnLang !== info.learnModelLanguage || learnSubject !== info.learnModelSubject;
  const removing = info.enabled.filter((m) => !enabled.includes(m));

  async function save() {
    if (removing.length && !confirm(t("llmModels.removeConfirm", { names: removing.map((m) => info!.models[m]?.title ?? m).join(", ") }))) return;
    setSaving(true);
    try {
      const r = await api.engine.saveLlmModels({ enabled, tutorModel: tutor, learnModelLanguage: learnLang, learnModelSubject: learnSubject });
      setInfo({ ...info!, enabled: r.enabled, tutorModel: r.tutorModel, learnModelLanguage: learnLang, learnModelSubject: learnSubject });
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
      {(
        [
          ["learnLanguage", learnLang, setLearnLang],
          ["learnSubject", learnSubject, setLearnSubject],
        ] as const
      ).map(([key, value, set]) => (
        <SettingRow key={key} label={t(`llmModels.${key}`)} hint={t(`llmModels.${key}Hint`)}>
          <select className="input w-full" value={value} onChange={(e) => set(e.target.value)}>
            <option value="">{t("llmModels.suggested")}</option>
            {enabled.map((id) => (
              <option key={id} value={id}>
                {info.models[id]?.title ?? id}
              </option>
            ))}
          </select>
        </SettingRow>
      ))}
      <div>
        <Button onClick={save} disabled={saving || !changed}>
          {t("ttsEngines.save")}
        </Button>
      </div>
    </Card>
  );
}
