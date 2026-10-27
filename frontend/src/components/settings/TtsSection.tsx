// Qwen3-TTS: Verbindung, Regler, Hörprobe
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";


export function TtsSection({ st }: { st: SettingsState }) {
  const { gpuResetBusy, llmConfig, previewAudioUrl, previewBusy, previewLang, previewText, previewVoiceId, qwenTtsKeyInput, removeApiKey, resetGpu, runPresetPreview, setLlmConfig, setPreviewLang, setPreviewText, setPreviewVoiceId, setQwenTtsKeyInput, voices } = st;
  return (
    <>
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.tts.title")}
          </h3>
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-neutral-300 sr-only">
              {t("settings.tts.title")}
            </h4>
            <details className="flex flex-col gap-2">
              <summary className="text-xs text-neutral-400 cursor-pointer">{t("settings.advanced")}</summary>
            <p className="text-xs text-neutral-500">
              {t("settings.tts.subtitle")}
            </p>
            <Input
              label={t("settings.tts.qwenTtsUrl")}
              type="url"
              value={llmConfig.qwenTtsUrl ?? ""}
              onChange={(e) =>
                setLlmConfig({ ...llmConfig, qwenTtsUrl: e.target.value })
              }
              placeholder="http://localhost:8790"
            />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label={t("settings.tts.qwenTtsApiKey")}
                  type="password"
                  value={qwenTtsKeyInput}
                  onChange={(e) => setQwenTtsKeyInput(e.target.value)}
                  placeholder={
                    llmConfig.qwenTtsApiKeyPresent
                      ? "•••"
                      : t("settings.tts.qwenTtsKeyPlaceholder")
                  }
                />
              </div>
              {llmConfig.qwenTtsApiKeyPresent && (
                <Button
                  variant="ghost"
                  onClick={() => removeApiKey("qwenTts")}
                >
                  {t("settings.llm.removeKey")}
                </Button>
              )}
            </div>

            <div className="flex items-start justify-between gap-3 pt-2">
              <p className="text-xs text-neutral-500 flex-1">
                {t("settings.tts.resetHint")}
              </p>
              <Button
                variant="outline"
                onClick={resetGpu}
                disabled={gpuResetBusy}
              >
                {gpuResetBusy
                  ? t("settings.tts.resetBusy")
                  : t("settings.tts.resetButton")}
              </Button>
            </div>
            </details>

            <div className="pt-3 border-t border-border flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.tts.instructionLabel")}
              </label>
              <textarea
                className="input min-h-[60px] resize-y"
                value={llmConfig.qwenTtsInstruction ?? ""}
                onChange={(e) =>
                  setLlmConfig({
                    ...llmConfig,
                    qwenTtsInstruction: e.target.value,
                  })
                }
                placeholder={t("settings.tts.instructionPlaceholder")}
              />
              <p className="text-xs text-neutral-500">
                {t("settings.tts.instructionHint")}
              </p>
            </div>

            <div className="pt-3 border-t border-border flex flex-col gap-2">
              <h4 className="text-xs font-semibold text-neutral-300">
                {t("settings.tts.tester.title")}
              </h4>
              <p className="text-xs text-neutral-500">
                {t("settings.tts.tester.subtitle")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <div className="flex flex-col gap-1 min-w-0">
                  <label className="text-xs font-medium text-neutral-400">
                    {t("settings.tts.tester.voice")}
                  </label>
                  <select
                    className="input"
                    value={previewVoiceId}
                    onChange={(e) => setPreviewVoiceId(e.target.value)}
                  >
                    {voices
                      .filter(
                        (v) =>
                          v.id.startsWith("preset:") &&
                          v.language === previewLang
                      )
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label} {v.flagship ? "★" : ""}
                        </option>
                      ))}
                    {voices.filter(
                      (v) =>
                        v.id.startsWith("preset:") && v.language === previewLang
                    ).length === 0 && (
                      <option value="">
                        {t("settings.tts.tester.noVoices")}
                      </option>
                    )}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-neutral-400">
                    {t("settings.tts.tester.language")}
                  </label>
                  <select
                    className="input"
                    value={previewLang}
                    onChange={(e) => {
                      const next = e.target.value as "de" | "en";
                      setPreviewLang(next);
                      // Adapt the voice to the new language when the
                      // current one doesn't exist for the new language
                      // (preset IDs are identical across languages, but
                      // we filter by language in the dropdown).
                      const stillOk = voices.some(
                        (v) => v.id === previewVoiceId && v.language === next
                      );
                      if (!stillOk) {
                        const fallback = voices.find(
                          (v) =>
                            v.id.startsWith("preset:") && v.language === next
                        );
                        if (fallback) setPreviewVoiceId(fallback.id);
                      }
                    }}
                  >
                    <option value="de">Deutsch</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
              <Input
                label={t("settings.tts.tester.text")}
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                placeholder={t("settings.tts.tester.textPlaceholder")}
              />

              <details className="text-xs text-neutral-400">
                <summary className="cursor-pointer select-none py-1 hover:text-neutral-200">
                  {t("settings.tts.tester.advanced")}
                </summary>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                  <Input
                    label={t("settings.tts.advanced.temperature")}
                    type="number"
                    step="0.05"
                    min={0}
                    max={2}
                    value={llmConfig.qwenTtsTemperature ?? ""}
                    onChange={(e) =>
                      setLlmConfig({
                        ...llmConfig,
                        qwenTtsTemperature: e.target.value,
                      })
                    }
                    placeholder="0.5"
                  />
                  <Input
                    label={t("settings.tts.advanced.topP")}
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    value={llmConfig.qwenTtsTopP ?? ""}
                    onChange={(e) =>
                      setLlmConfig({
                        ...llmConfig,
                        qwenTtsTopP: e.target.value,
                      })
                    }
                    placeholder="0.8"
                  />
                  <Input
                    label={t("settings.tts.advanced.topK")}
                    type="number"
                    step="1"
                    min={1}
                    max={200}
                    value={llmConfig.qwenTtsTopK ?? ""}
                    onChange={(e) =>
                      setLlmConfig({
                        ...llmConfig,
                        qwenTtsTopK: e.target.value,
                      })
                    }
                    placeholder="40"
                  />
                  <Input
                    label={t("settings.tts.advanced.repetitionPenalty")}
                    type="number"
                    step="0.01"
                    min={1}
                    max={2}
                    value={llmConfig.qwenTtsRepetitionPenalty ?? ""}
                    onChange={(e) =>
                      setLlmConfig({
                        ...llmConfig,
                        qwenTtsRepetitionPenalty: e.target.value,
                      })
                    }
                    placeholder="1.05"
                  />
                  <Input
                    label={t("settings.tts.advanced.chunkSize")}
                    type="number"
                    step="250"
                    min={500}
                    max={8000}
                    value={llmConfig.ttsMaxChunk ?? ""}
                    onChange={(e) =>
                      setLlmConfig({
                        ...llmConfig,
                        ttsMaxChunk: e.target.value,
                      })
                    }
                    placeholder="2500"
                  />
                </div>
                {(() => {
                  // Live-warning when the chunk size is outside the
                  // backend's accepted band [500, 8000]. The server
                  // silently clamps to the default 2500 in that case
                  // — easy to miss without a UI hint.
                  const raw = (llmConfig.ttsMaxChunk ?? "").trim();
                  if (!raw) return null;
                  const n = Number(raw);
                  if (!Number.isFinite(n)) return null;
                  if (n < 500 || n > 8000) {
                    return (
                      <p className="text-xs text-red-400 pt-2">
                        {t("settings.tts.advanced.chunkSizeOutOfRange")}
                      </p>
                    );
                  }
                  return null;
                })()}
                <p className="text-xs text-neutral-500 pt-2">
                  {t("settings.tts.advanced.hint")}
                </p>
              </details>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={runPresetPreview}
                  disabled={
                    previewBusy || !previewVoiceId || !previewText.trim()
                  }
                >
                  {previewBusy
                    ? t("settings.tts.tester.busy")
                    : t("settings.tts.tester.run")}
                </Button>
                <span className="text-xs text-neutral-500">
                  {t("settings.tts.tester.hint")}
                </span>
              </div>
              {previewAudioUrl && (
                <audio
                  controls
                  src={previewAudioUrl}
                  className="w-full mt-1"
                  autoPlay
                />
              )}
            </div>
          </div>

        </section>

    </>
  );
}
