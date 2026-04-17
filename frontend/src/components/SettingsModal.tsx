import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { getSettings, setSettings, type Settings } from "../lib/settings";
import { api, type OllamaStatus, type Voice } from "../lib/api";
import { useToast } from "./ui/Toast";
import { LOCALE_LABELS, t, useLocale, type Locale } from "../lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

const RATES: Array<{ value: string; key: string }> = [
  { value: "-10%", key: "rate.-10" },
  { value: "+0%", key: "rate.0" },
  { value: "+10%", key: "rate.+10" },
  { value: "+20%", key: "rate.+20" },
  { value: "+30%", key: "rate.+30" },
];

export function SettingsModal({ open, onClose }: Props) {
  useLocale();
  const [s, setS] = useState<Settings>(getSettings());
  const [voices, setVoices] = useState<Voice[]>([]);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [meiliEnabled, setMeiliEnabled] = useState<boolean | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setS(getSettings());
    api.audio.voices().then((r) => setVoices(r.voices)).catch(() => setVoices([]));
    api.summary.status().then(setOllama).catch(() => setOllama(null));
    api.search.status().then((r) => setMeiliEnabled(r.enabled)).catch(() => setMeiliEnabled(false));
  }, [open]);

  function save() {
    setSettings(s);
    toast.show(t("settings.saved"), "success");
    onClose();
  }

  const voicesForLang = voices.filter((v) => v.language === s.defaultLanguage);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("settings.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.section.locale")}
          </h3>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400">
              {t("settings.locale")}
            </label>
            <select
              className="input"
              value={s.locale || ""}
              onChange={(e) =>
                setS({ ...s, locale: (e.target.value || "") as Locale | "" })
              }
            >
              <option value="">Auto</option>
              {(Object.keys(LOCALE_LABELS) as Locale[]).map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.section.library")}
          </h3>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400">
              {t("settings.defaultLanguage")}
            </label>
            <select
              className="input"
              value={s.defaultLanguage}
              onChange={(e) =>
                setS({ ...s, defaultLanguage: e.target.value as Settings["defaultLanguage"] })
              }
            >
              <option value="en">English</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.section.audiobook")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.defaultVoice")}
              </label>
              <select
                className="input"
                value={s.defaultVoice}
                onChange={(e) => setS({ ...s, defaultVoice: e.target.value })}
              >
                <option value="">{t("settings.voice.server")}</option>
                {voicesForLang.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.defaultRate")}
              </label>
              <select
                className="input"
                value={s.defaultRate}
                onChange={(e) => setS({ ...s, defaultRate: e.target.value })}
              >
                {RATES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {t(r.key)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.section.exam")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label={t("settings.defaultExamCount")}
              type="number"
              min={1}
              max={200}
              value={s.defaultExamCount}
              onChange={(e) =>
                setS({ ...s, defaultExamCount: Math.max(1, Number(e.target.value) || 20) })
              }
            />
            <Input
              label={t("settings.defaultExamMinutes")}
              type="number"
              min={0}
              max={600}
              value={s.defaultExamMinutes}
              onChange={(e) =>
                setS({ ...s, defaultExamMinutes: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.section.ai")}
          </h3>
          {ollama?.available ? (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.defaultOllamaModel")}
                </label>
                <select
                  className="input"
                  value={s.defaultOllamaModel}
                  onChange={(e) => setS({ ...s, defaultOllamaModel: e.target.value })}
                >
                  <option value="">
                    {t("settings.ollama.server", { model: ollama.defaultModel })}
                  </option>
                  {ollama.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-neutral-500">
                {t("settings.ollama.connected", { url: ollama.url })}
              </p>
            </>
          ) : (
            <p className="text-xs text-neutral-500">{t("settings.ollama.disabled")}</p>
          )}
        </section>

        <section className="flex flex-col gap-2 pt-2 border-t border-border">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.section.status")}
          </h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <StatusRow
              label="Meilisearch"
              ok={meiliEnabled === true}
              waiting={meiliEnabled === null}
            />
            <StatusRow
              label="Ollama"
              ok={ollama?.available === true}
              waiting={ollama === null}
            />
          </div>
        </section>
      </div>
    </Modal>
  );
}

function StatusRow({ label, ok, waiting }: { label: string; ok: boolean; waiting: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={
          "inline-block w-2 h-2 rounded-full " +
          (waiting ? "bg-neutral-600" : ok ? "bg-emerald-500" : "bg-accent")
        }
      />
      <span className="text-neutral-400">{label}:</span>
      <span className={ok ? "text-emerald-400" : waiting ? "text-neutral-500" : "text-accent"}>
        {waiting
          ? t("settings.status.checking")
          : ok
          ? t("settings.status.online")
          : t("settings.status.offline")}
      </span>
    </div>
  );
}
