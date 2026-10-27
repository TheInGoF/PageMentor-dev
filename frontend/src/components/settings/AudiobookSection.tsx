// Hörbuch-Grundeinstellungen
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";
import { RATES } from "./types";


export function AudiobookSection({ st }: { st: SettingsState }) {
  const { absBusy, absKeyInput, absLibraries, absTest, absTestResult, llmConfig, removeApiKey, s, setAbsKeyInput, setLlmConfig, setS, voicesForLang } = st;
  return (
    <>
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
                    {r.value === "+0%" ? t("rate.0") : r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-4 mt-2 border-t border-border flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-neutral-300">
              {t("settings.abs.title")}
            </h4>
            <p className="text-xs text-neutral-500">
              {t("settings.abs.subtitle")}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={llmConfig.absEnabled === "1"}
                onChange={(e) =>
                  setLlmConfig({ ...llmConfig, absEnabled: e.target.checked ? "1" : "" })
                }
              />
              {t("settings.abs.enable")}
            </label>
            {llmConfig.absEnabled === "1" && (
            <>
            <Input
              label={t("settings.abs.url")}
              type="url"
              value={llmConfig.absUrl ?? ""}
              onChange={(e) =>
                setLlmConfig({ ...llmConfig, absUrl: e.target.value })
              }
              placeholder="http://audiobookshelf.local:13378"
            />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label={t("settings.abs.apiKey")}
                  type="password"
                  value={absKeyInput}
                  onChange={(e) => setAbsKeyInput(e.target.value)}
                  placeholder={
                    llmConfig.absApiKeyPresent
                      ? "•••"
                      : t("settings.abs.apiKeyPlaceholder")
                  }
                />
              </div>
              {llmConfig.absApiKeyPresent && (
                <Button variant="ghost" onClick={() => removeApiKey("abs")}>
                  {t("settings.llm.removeKey")}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={absTest}
                disabled={
                  absBusy ||
                  !llmConfig.absUrl ||
                  (!llmConfig.absApiKeyPresent && !absKeyInput.trim())
                }
              >
                {absBusy ? t("settings.abs.testing") : t("settings.abs.test")}
              </Button>
              {absTestResult && (
                <span
                  className={
                    "text-xs " +
                    (absTestResult.ok ? "text-emerald-400" : "text-accent")
                  }
                >
                  {absTestResult.ok ? "✓" : "✗"} {absTestResult.text}
                </span>
              )}
            </div>

            {absLibraries.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.abs.library")}
                </label>
                <select
                  className="input"
                  value={llmConfig.absLibraryId ?? ""}
                  onChange={(e) =>
                    setLlmConfig({
                      ...llmConfig,
                      absLibraryId: e.target.value,
                    })
                  }
                >
                  <option value="">{t("settings.abs.libraryNone")}</option>
                  {absLibraries.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-xs text-neutral-500">
              {t("settings.abs.hint")}
            </p>
            </>
            )}

          </div>
        </section>

    </>
  );
}
