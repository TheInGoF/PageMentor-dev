// KI: Sprachmodell vorn, Anbieter, Adressen und Server-Vorgabe als Expertenoptionen am Ende
import { Input } from "../ui/Input";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";
import { ApiProviderBlock } from "./ApiProviderBlock";
import { Card, Expert, Notice, SettingRow, SubTitle } from "./parts";

export function AiSection({ st }: { st: SettingsState }) {
  const { ollama, s, setS } = st;
  return (
    <Card
      title={t("ai.model.title")}
      status={ollama?.available ? `✓ ${ollama.label ?? ollama.url}` : t("settings.llm.inactive")}
    >
      {ollama?.available ? (
        <SettingRow label={t("ai.model.label")} hint={t("ai.model.hint")}>
          {/* Diese Auswahl lesen alle KI-Abläufe (Karten, Hörbuch-Aufbereitung, Tutor) beim Aufruf */}
          <select className="input w-full" value={s.defaultOllamaModel} onChange={(e) => setS({ ...s, defaultOllamaModel: e.target.value })}>
            <option value="">{ollama.defaultModel ? t("settings.ollama.server", { model: ollama.defaultModel }) : t("ai.model.auto")}</option>
            {ollama.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </SettingRow>
      ) : (
        <Notice kind="warn">{t("settings.ollama.disabled")}</Notice>
      )}
    </Card>
  );
}

// Anbieter in der Cloud und Adressen: selten gebraucht, darum eingeklappt am Ende der Seite
export function AiExpert({ st }: { st: SettingsState }) {
  const { anthropicKeyInput, googleKeyInput, llmConfig, ollama, openaiKeyInput, removeApiKey, setAnthropicKeyInput, setGoogleKeyInput, setLlmConfig, setOpenaiKeyInput } = st;
  const url = (key: "ollamaUrlPc" | "ollamaUrlMac" | "ollamaUrl" | "teiUrl", label: string, placeholder: string) => (
    <Input label={t(label)} type="url" value={llmConfig[key] ?? ""} onChange={(e) => setLlmConfig({ ...llmConfig, [key]: e.target.value })} placeholder={placeholder} />
  );
  return (
    <Expert title={t("ai.expert.title")}>
      <div className="flex flex-col gap-4">
        <SubTitle>{t("ai.expert.providers")}</SubTitle>
        <p className="text-xs text-neutral-500">{t("ai.expert.providersHint")}</p>
        <ApiProviderBlock
          label={t("settings.llm.anthropicApiKey")}
          placeholder={t("settings.llm.anthropicKeyPlaceholder")}
          keyPresent={!!llmConfig.anthropicApiKeyPresent}
          keyInput={anthropicKeyInput}
          onKeyChange={setAnthropicKeyInput}
          onRemove={() => removeApiKey("anthropic")}
          modelLabel={t("settings.llm.anthropicModel")}
          modelPlaceholder="claude-haiku-4-5-20251001"
          modelValue={llmConfig.anthropicModel ?? ""}
          onModelChange={(v) => setLlmConfig({ ...llmConfig, anthropicModel: v })}
        />
        <ApiProviderBlock
          label={t("settings.llm.openaiApiKey")}
          placeholder={t("settings.llm.openaiKeyPlaceholder")}
          keyPresent={!!llmConfig.openaiApiKeyPresent}
          keyInput={openaiKeyInput}
          onKeyChange={setOpenaiKeyInput}
          onRemove={() => removeApiKey("openai")}
          modelLabel={t("settings.llm.openaiModel")}
          modelPlaceholder="gpt-4o-mini"
          modelValue={llmConfig.openaiModel ?? ""}
          onModelChange={(v) => setLlmConfig({ ...llmConfig, openaiModel: v })}
        />
        <ApiProviderBlock
          label={t("settings.llm.googleApiKey")}
          placeholder={t("settings.llm.googleKeyPlaceholder")}
          keyPresent={!!llmConfig.googleApiKeyPresent}
          keyInput={googleKeyInput}
          onKeyChange={setGoogleKeyInput}
          onRemove={() => removeApiKey("google")}
          modelLabel={t("settings.llm.googleModel")}
          modelPlaceholder="gemini-2.0-flash"
          modelValue={llmConfig.googleModel ?? ""}
          onModelChange={(v) => setLlmConfig({ ...llmConfig, googleModel: v })}
        />
      </div>
      <div className="flex flex-col gap-4">
        <SubTitle>{t("ai.expert.connection")}</SubTitle>
        <p className="text-xs text-neutral-500">
          {t("settings.llm.subtitle")}
          {ollama?.candidates ? ` ${t("settings.llm.candidates", { n: ollama.candidates.length })}` : ""}
        </p>
        <Input label={t("settings.llm.ollamaModel")} value={llmConfig.ollamaModel ?? ""} onChange={(e) => setLlmConfig({ ...llmConfig, ollamaModel: e.target.value })} placeholder="auto" />
        {url("ollamaUrlPc", "settings.llm.ollamaUrlPc", "http://localhost:8790")}
        {url("ollamaUrlMac", "settings.llm.ollamaUrlMac", "http://mac.local:11434")}
        {url("ollamaUrl", "settings.llm.ollamaUrl", "http://localhost:11434")}
        {url("teiUrl", "settings.llm.teiUrl", "http://localhost:8080")}
      </div>
    </Expert>
  );
}
