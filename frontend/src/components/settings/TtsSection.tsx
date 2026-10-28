// Qwen3-TTS für Experten: Vorgabe-Stimmen, Sprech-Anweisung, Hörprobe, Regler, Verbindung
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";
import { Expert, SettingRow, SubTitle } from "./parts";

const DIALS = [
  { key: "qwenTtsTemperature", label: "settings.tts.advanced.temperature", step: "0.05", min: 0, max: 2, ph: "0.75" },
  { key: "qwenTtsTopP", label: "settings.tts.advanced.topP", step: "0.05", min: 0, max: 1, ph: "0.8" },
  { key: "qwenTtsTopK", label: "settings.tts.advanced.topK", step: "1", min: 1, max: 200, ph: "40" },
  { key: "qwenTtsRepetitionPenalty", label: "settings.tts.advanced.repetitionPenalty", step: "0.01", min: 1, max: 2, ph: "1.15" },
  { key: "ttsMaxChunk", label: "settings.tts.advanced.chunkSize", step: "250", min: 500, max: 8000, ph: "2500" },
] as const;

export function TtsSection({ st }: { st: SettingsState }) {
  const {
    gpuResetBusy, llmConfig, previewAudioUrl, previewBusy, previewLang, previewText, previewVoiceId, qwenTtsKeyInput, removeApiKey, resetGpu, runPresetPreview,
    setLlmConfig, setPreviewLang, setPreviewText, setPreviewVoiceId, setQwenTtsKeyInput, voices, presetVisibility, togglePresetVisibility,
  } = st;
  const presets = voices.filter((v) => v.id.startsWith("preset:") && v.language === previewLang);
  const chunk = Number((llmConfig.ttsMaxChunk ?? "").trim());
  const chunkBad = !!(llmConfig.ttsMaxChunk ?? "").trim() && Number.isFinite(chunk) && (chunk < 500 || chunk > 8000);

  return (
    <Expert title={t("voices.qwen.title")}>
      <div className="flex flex-col gap-2">
        <SubTitle>{t("voices.qwen.presets")}</SubTitle>
        <p className="text-xs text-neutral-500">{t("voices.qwen.presetsHint")}</p>
        {presetVisibility.length === 0 ? (
          <p className="text-sm text-neutral-500">{t("settings.presets.empty")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {presetVisibility.map((p) => (
              <button
                key={p.voice.id + p.voice.language}
                type="button"
                onClick={() => togglePresetVisibility(p.voice.id, !p.visible)}
                className={"rounded-full border px-4 py-2 text-sm " + (p.visible ? "border-accent/40 bg-accent/10" : "border-border text-neutral-500")}
                title={t(p.visible ? "settings.voices.hide" : "settings.voices.unhide")}
              >
                {p.voice.gender === "female" ? "♀" : "♂"} {p.voice.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SubTitle>{t("voices.qwen.instruction")}</SubTitle>
        <textarea
          className="input min-h-[64px] resize-y"
          value={llmConfig.qwenTtsInstruction ?? ""}
          onChange={(e) => setLlmConfig({ ...llmConfig, qwenTtsInstruction: e.target.value })}
          placeholder={t("settings.tts.instructionPlaceholder")}
        />
        <p className="text-xs text-neutral-500">{t("voices.qwen.instructionHint")}</p>
      </div>

      <div className="flex flex-col gap-4">
        <SubTitle>{t("voices.qwen.tester")}</SubTitle>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
          <select className="input" value={previewVoiceId} onChange={(e) => setPreviewVoiceId(e.target.value)} aria-label={t("settings.tts.tester.voice")}>
            {presets.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} {v.flagship ? "★" : ""}
              </option>
            ))}
            {presets.length === 0 && <option value="">{t("settings.tts.tester.noVoices")}</option>}
          </select>
          <select
            className="input"
            value={previewLang}
            aria-label={t("settings.tts.tester.language")}
            onChange={(e) => {
              const next = e.target.value as "de" | "en";
              setPreviewLang(next);
              if (!voices.some((v) => v.id === previewVoiceId && v.language === next)) {
                const fallback = voices.find((v) => v.id.startsWith("preset:") && v.language === next);
                if (fallback) setPreviewVoiceId(fallback.id);
              }
            }}
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </div>
        <Input value={previewText} onChange={(e) => setPreviewText(e.target.value)} placeholder={t("settings.tts.tester.textPlaceholder")} aria-label={t("settings.tts.tester.text")} />
        <div>
          <Button variant="outline" onClick={runPresetPreview} disabled={previewBusy || !previewVoiceId || !previewText.trim()}>
            {previewBusy ? t("settings.tts.tester.busy") : t("settings.tts.tester.run")}
          </Button>
        </div>
        {previewAudioUrl && <audio controls src={previewAudioUrl} className="w-full" autoPlay />}
      </div>

      <div className="flex flex-col gap-4">
        <SubTitle>{t("voices.qwen.dials")}</SubTitle>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {DIALS.map((d) => (
            <Input
              key={d.key}
              label={t(d.label)}
              type="number"
              step={d.step}
              min={d.min}
              max={d.max}
              value={llmConfig[d.key] ?? ""}
              onChange={(e) => setLlmConfig({ ...llmConfig, [d.key]: e.target.value })}
              placeholder={d.ph}
            />
          ))}
        </div>
        {chunkBad && <p className="text-xs text-red-400">{t("settings.tts.advanced.chunkSizeOutOfRange")}</p>}
        <p className="text-xs text-neutral-500">{t("voices.qwen.dialsHint")}</p>
      </div>

      <div className="flex flex-col gap-4">
        <SubTitle>{t("voices.qwen.connection")}</SubTitle>
        <Input
          label={t("settings.tts.qwenTtsUrl")}
          type="url"
          value={llmConfig.qwenTtsUrl ?? ""}
          onChange={(e) => setLlmConfig({ ...llmConfig, qwenTtsUrl: e.target.value })}
          placeholder="http://localhost:8790"
        />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label={t("settings.tts.qwenTtsApiKey")}
              type="password"
              value={qwenTtsKeyInput}
              onChange={(e) => setQwenTtsKeyInput(e.target.value)}
              placeholder={llmConfig.qwenTtsApiKeyPresent ? "•••" : t("settings.tts.qwenTtsKeyPlaceholder")}
            />
          </div>
          {llmConfig.qwenTtsApiKeyPresent && (
            <Button variant="ghost" onClick={() => removeApiKey("qwenTts")}>
              {t("settings.llm.removeKey")}
            </Button>
          )}
        </div>
        <SettingRow label={t("settings.tts.resetButton")} hint={t("voices.qwen.resetHint")}>
          <Button variant="outline" className="w-full" onClick={resetGpu} disabled={gpuResetBusy}>
            {gpuResetBusy ? t("settings.tts.resetBusy") : t("voices.qwen.reset")}
          </Button>
        </SettingRow>
      </div>
    </Expert>
  );
}
