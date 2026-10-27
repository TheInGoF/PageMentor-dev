// KI-Modelle: Ollama, Cloud-Anbieter, Modellwahl
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";
import { ApiProviderBlock } from "./ApiProviderBlock";


export function AiSection({ st }: { st: SettingsState }) {
  const { anthropicKeyInput, googleKeyInput, llmConfig, ollama, openaiKeyInput, ragStatus, reembedAll, reembedBusy, removeApiKey, s, setAnthropicKeyInput, setGoogleKeyInput, setLlmConfig, setOpenaiKeyInput, setS } = st;
  return (
    <>
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.llm.title")}
          </h3>
          <p className="text-xs text-neutral-500">{t("settings.llm.subtitle")}</p>

          <div className="text-xs">
            {ollama?.available ? (
              <span className="text-emerald-400">
                ✓ {t("settings.llm.active", { label: ollama.label ?? ollama.url })}
              </span>
            ) : (
              <span className="text-red-400">✗ {t("settings.llm.inactive")}</span>
            )}
            {ollama?.candidates && (
              <span className="text-neutral-500 ml-2">
                · {t("settings.llm.candidates", { n: ollama.candidates.length })}
              </span>
            )}
          </div>

          <Input
            label={t("settings.llm.ollamaModel")}
            value={llmConfig.ollamaModel ?? ""}
            onChange={(e) => setLlmConfig({ ...llmConfig, ollamaModel: e.target.value })}
            placeholder="auto"
          />

          <details className="flex flex-col gap-3">
            <summary className="text-xs text-neutral-400 cursor-pointer">{t("settings.advanced")}</summary>
          <Input
            label={t("settings.llm.ollamaUrlPc")}
            type="url"
            value={llmConfig.ollamaUrlPc ?? ""}
            onChange={(e) => setLlmConfig({ ...llmConfig, ollamaUrlPc: e.target.value })}
            placeholder="http://localhost:8790"
          />
          <Input
            label={t("settings.llm.ollamaUrlMac")}
            type="url"
            value={llmConfig.ollamaUrlMac ?? ""}
            onChange={(e) => setLlmConfig({ ...llmConfig, ollamaUrlMac: e.target.value })}
            placeholder="http://mac.local:11434"
          />
          <Input
            label={t("settings.llm.ollamaUrl")}
            type="url"
            value={llmConfig.ollamaUrl ?? ""}
            onChange={(e) => setLlmConfig({ ...llmConfig, ollamaUrl: e.target.value })}
            placeholder="http://localhost:11434"
          />
          <Input
            label={t("settings.llm.teiUrl")}
            type="url"
            value={llmConfig.teiUrl ?? ""}
            onChange={(e) => setLlmConfig({ ...llmConfig, teiUrl: e.target.value })}
            placeholder="http://localhost:8080"
          />
          </details>

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


          {/* Per-user model picker (was a separate "KI" tab before
              v1.18.193). Lives here because every AI workflow (audio
              preprocess, card build, tutor) reads this localStorage
              value at call time via getSettings().defaultOllamaModel,
              and the picker pulls its list from the same Ollama URL
              the LLM-chain config above points at. */}
          <div className="pt-4 mt-2 border-t border-border flex flex-col gap-3">
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
                    onChange={(e) =>
                      setS({ ...s, defaultOllamaModel: e.target.value })
                    }
                  >
                    <option value="">
                      {t("settings.ollama.server", {
                        model: ollama.defaultModel,
                      })}
                    </option>
                    {ollama.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-neutral-500">
                  {t("settings.ollama.connected", { url: ollama.url })}
                </p>
              </>
            ) : (
              <p className="text-xs text-neutral-500">
                {t("settings.ollama.disabled")}
              </p>
            )}

            <div className="flex flex-col gap-2 pt-3 border-t border-border">
              <h4 className="text-xs uppercase tracking-wide text-neutral-500">
                {t("settings.embed.title")}
              </h4>
              {ragStatus ? (
                <p className="text-xs text-neutral-500">
                  {t("settings.embed.stats", {
                    embedded: ragStatus.embedded,
                    total: ragStatus.total,
                    docs: ragStatus.documents,
                  })}
                </p>
              ) : (
                <p className="text-xs text-neutral-500">
                  {t("settings.embed.statsLoading")}
                </p>
              )}
              <p className="text-xs text-neutral-500">
                {t("settings.embed.hint")}
              </p>
              <Button
                variant="outline"
                onClick={reembedAll}
                disabled={reembedBusy || !ollama?.available}
              >
                {reembedBusy
                  ? t("settings.embed.reembedBusy")
                  : t("settings.embed.reembed")}
              </Button>
            </div>
          </div>
        </section>

    </>
  );
}
