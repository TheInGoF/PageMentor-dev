// Hörprobe für Preset-Stimmen mit ungespeicherten Reglern
import { useEffect, useState } from "react";
import { getSettings } from "../../lib/settings";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import type { SettingsCore } from "./useSettingsCore";

export function usePresetTester(core: SettingsCore) {
  const { toast, llmConfig } = core;
  const [previewVoiceId, setPreviewVoiceId] = useState<string>("");
  const [previewLang, setPreviewLang] = useState<"de" | "en">("de");
  const [previewText, setPreviewText] = useState<string>("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  useEffect(() => {
    api.audio.voices().then((r) => {
      setPreviewVoiceId((prev) => {
        if (prev) return prev;
        const presets = r.voices.filter((v) => v.id.startsWith("preset:"));
        const lang = getSettings().defaultLanguage;
        return presets.find((v) => v.language === lang)?.id ?? presets[0]?.id ?? "";
      });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
    };
  }, [previewAudioUrl]);

  useEffect(() => {
    // Default text per language, only while the user hasn't typed
    // anything of their own yet.
    if (previewText) return;
    setPreviewText(
      previewLang === "de"
        ? "Dies ist eine kurze Hörprobe für die gewählte Stimme."
        : "This is a short voice preview for the selected preset."
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewLang]);

  async function runPresetPreview() {
    if (!previewVoiceId || !previewText.trim()) return;
    setPreviewBusy(true);
    try {
      const url = api.audio.previewUrl(previewVoiceId, {
        text: previewText.trim(),
        // Current form state — including unsaved changes, so the
        // user immediately hears what they typed without having to
        // save first.
        instruct: llmConfig.qwenTtsInstruction ?? "",
        temperature: llmConfig.qwenTtsTemperature || undefined,
        topP: llmConfig.qwenTtsTopP || undefined,
        topK: llmConfig.qwenTtsTopK || undefined,
        repetitionPenalty: llmConfig.qwenTtsRepetitionPenalty || undefined,
      });
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Preview ${res.status}: ${body.slice(0, 200)}`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPreviewAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return blobUrl;
      });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setPreviewBusy(false);
    }
  }

  return {
    previewAudioUrl,
    previewBusy,
    previewLang,
    previewText,
    previewVoiceId,
    runPresetPreview,
    setPreviewAudioUrl,
    setPreviewBusy,
    setPreviewLang,
    setPreviewText,
    setPreviewVoiceId,
  };
}

export type PresetTester = ReturnType<typeof usePresetTester>;
