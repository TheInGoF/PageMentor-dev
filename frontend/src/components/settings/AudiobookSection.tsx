// Hörbuch-Grundeinstellungen: Standardstimmen je Sprache, Tempo, Audiobookshelf
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";
import { RATES } from "./types";
import { Card, SettingRow } from "./parts";
import { VoiceDefaultsRows } from "./VoiceDefaultsRows";

export function AudiobookSection({ st }: { st: SettingsState }) {
  const { absBusy, absKeyInput, absLibraries, absTest, absTestResult, llmConfig, removeApiKey, s, setAbsKeyInput, setLlmConfig, setS, voices } = st;
  const absOn = llmConfig.absEnabled === "1";
  return (
    <Card title={t("settings.section.audiobook")}>
      <VoiceDefaultsRows voices={voices} />
      <SettingRow label={t("settings.defaultRate")}>
        <select className="input w-full" value={s.defaultRate} onChange={(e) => setS({ ...s, defaultRate: e.target.value })}>
          {RATES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.value === "+0%" ? t("rate.0") : r.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t("settings.abs.title")} hint={t("settings.abs.short")}>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={absOn} onChange={(e) => setLlmConfig({ ...llmConfig, absEnabled: e.target.checked ? "1" : "" })} />
          {t("settings.abs.enableShort")}
        </label>
      </SettingRow>

      {absOn && (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <Input
            label={t("settings.abs.url")}
            type="url"
            value={llmConfig.absUrl ?? ""}
            onChange={(e) => setLlmConfig({ ...llmConfig, absUrl: e.target.value })}
            placeholder="http://audiobookshelf.local:13378"
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={t("settings.abs.apiKey")}
                type="password"
                value={absKeyInput}
                onChange={(e) => setAbsKeyInput(e.target.value)}
                placeholder={llmConfig.absApiKeyPresent ? "•••" : t("settings.abs.apiKeyPlaceholder")}
              />
            </div>
            {llmConfig.absApiKeyPresent && (
              <Button variant="ghost" onClick={() => removeApiKey("abs")}>
                {t("settings.llm.removeKey")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={absTest} disabled={absBusy || !llmConfig.absUrl || (!llmConfig.absApiKeyPresent && !absKeyInput.trim())}>
              {absBusy ? t("settings.abs.testing") : t("settings.abs.test")}
            </Button>
            {absTestResult && (
              <span className={"text-xs " + (absTestResult.ok ? "text-emerald-400" : "text-accent")}>
                {absTestResult.ok ? "✓" : "✗"} {absTestResult.text}
              </span>
            )}
          </div>
          {absLibraries.length > 0 && (
            <SettingRow label={t("settings.abs.library")}>
              <select className="input w-full" value={llmConfig.absLibraryId ?? ""} onChange={(e) => setLlmConfig({ ...llmConfig, absLibraryId: e.target.value })}>
                <option value="">{t("settings.abs.libraryNone")}</option>
                {absLibraries.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </SettingRow>
          )}
        </div>
      )}
    </Card>
  );
}
