// Zustand und Aktionen der Einstellungen: Grundwerte, KI, ABS, Status
import { useEffect, useRef, useState } from "react";
import { getSettings, setSettings, type Settings } from "../../lib/settings";
import {
  api,
  type OllamaStatus,
  type Voice,
} from "../../lib/api";
import { useToast } from "../ui/Toast";
import { t } from "../../lib/i18n";
import type { LlmConfig, SettingsTab } from "./types";

export function useSettingsCore(initialTab?: SettingsTab) {
  const [s, setS] = useState<Settings>(getSettings());
  const [voices, setVoices] = useState<Voice[]>([]);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [meiliEnabled, setMeiliEnabled] = useState<boolean | null>(null);
  const [doclingAlive, setDoclingAlive] = useState<boolean | null>(null);
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
  // Snapshot of the last server-persisted config — lets the header
  // Save detect unsaved LLM/TTS/ABS edits (null until first load).
  const savedLlmConfigRef = useRef<string | null>(null);
  const [anthropicKeyInput, setAnthropicKeyInput] = useState("");
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [googleKeyInput, setGoogleKeyInput] = useState("");
  const [qwenTtsKeyInput, setQwenTtsKeyInput] = useState("");
  const [absKeyInput, setAbsKeyInput] = useState("");
  const [absLibraries, setAbsLibraries] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [absTestResult, setAbsTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [absBusy, setAbsBusy] = useState(false);
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "home");
  const [llmBusy, setLlmBusy] = useState(false);
  const [gpuResetBusy, setGpuResetBusy] = useState(false);
  const [ragStatus, setRagStatus] = useState<{
    total: number;
    embedded: number;
    documents: number;
  } | null>(null);
  const [reembedBusy, setReembedBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    setS(getSettings());
    api.audio
      .voices()
      .then((r) => {
        setVoices(r.voices);
      })
      .catch(() => setVoices([]));
    api.search.status().then((r) => setMeiliEnabled(r.enabled)).catch(() => setMeiliEnabled(false));
    api.health().then((r) => setBackendVersion(r.version)).catch(() => setBackendVersion(null));
    api.documents.doclingStatus().then((r) => setDoclingAlive(r.alive)).catch(() => setDoclingAlive(false));
    api.rag.status().then(setRagStatus).catch(() => setRagStatus(null));
    api.llmConfig
      .get()
      .then((r) => {
        setLlmConfig(r.config);
        savedLlmConfigRef.current = JSON.stringify(r.config);
        setOllama(r.status);
        // Library-Liste automatisch nachladen wenn ABS konfiguriert ist,
        // damit das Dropdown nach Neustart die gespeicherte Auswahl anzeigt.
        if (r.config.absEnabled === "1" && r.config.absUrl && r.config.absApiKeyPresent) {
          api.abs
            .libraries()
            .then((libs) =>
              setAbsLibraries(
                libs.libraries.map((l) => ({ id: l.id, name: l.name }))
              )
            )
            .catch(() => setAbsLibraries([]));
          api.abs
            .test()
            .then((tr) =>
              setAbsTestResult({
                ok: tr.ok,
                text: tr.ok
                  ? t("settings.abs.testOk", {
                      user: tr.username ?? "?",
                      version: tr.serverVersion ?? "?",
                    })
                  : tr.message ?? t("common.error"),
              })
            )
            .catch(() => {});
        }
      })
      .catch(() => setOllama(null));
    setAnthropicKeyInput("");
    setOpenaiKeyInput("");
    // Mount-only, lädt einmal beim Öffnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveLlmConfig() {
    setLlmBusy(true);
    try {
      const patch: Record<string, string | undefined> = {
        ollamaUrlPc: llmConfig.ollamaUrlPc ?? "",
        ollamaUrlMac: llmConfig.ollamaUrlMac ?? "",
        ollamaUrl: llmConfig.ollamaUrl ?? "",
        ollamaModel: llmConfig.ollamaModel ?? "",
        teiUrl: llmConfig.teiUrl ?? "",
        anthropicModel: llmConfig.anthropicModel ?? "",
        openaiModel: llmConfig.openaiModel ?? "",
        googleModel: llmConfig.googleModel ?? "",
        qwenTtsUrl: llmConfig.qwenTtsUrl ?? "",
        qwenTtsInstruction: llmConfig.qwenTtsInstruction ?? "",
        qwenTtsTemperature: llmConfig.qwenTtsTemperature ?? "",
        qwenTtsTopP: llmConfig.qwenTtsTopP ?? "",
        qwenTtsTopK: llmConfig.qwenTtsTopK ?? "",
        qwenTtsRepetitionPenalty: llmConfig.qwenTtsRepetitionPenalty ?? "",
        ttsMaxChunk: llmConfig.ttsMaxChunk ?? "",
        doclingCharts: llmConfig.doclingCharts === "1" ? "1" : "",
        absEnabled: llmConfig.absEnabled === "1" ? "1" : "",
        absUrl: llmConfig.absUrl ?? "",
        absLibraryId: llmConfig.absLibraryId ?? "",
      };
      if (anthropicKeyInput.trim()) patch.anthropicApiKey = anthropicKeyInput.trim();
      if (openaiKeyInput.trim()) patch.openaiApiKey = openaiKeyInput.trim();
      if (googleKeyInput.trim()) patch.googleApiKey = googleKeyInput.trim();
      if (qwenTtsKeyInput.trim()) patch.qwenTtsApiKey = qwenTtsKeyInput.trim();
      if (absKeyInput.trim()) patch.absApiKey = absKeyInput.trim();
      const res = await api.llmConfig.put(patch);
      setLlmConfig(res.config as LlmConfig);
      savedLlmConfigRef.current = JSON.stringify(res.config);
      setOllama(res.status);
      setAnthropicKeyInput("");
      setOpenaiKeyInput("");
      setGoogleKeyInput("");
      setQwenTtsKeyInput("");
      setAbsKeyInput("");
      toast.show(t("settings.llm.saved"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setLlmBusy(false);
    }
  }

  // Clean up the blob URL on unmount / modal close, otherwise the

  async function absTest() {
    setAbsBusy(true);
    setAbsTestResult(null);
    try {
      if (absKeyInput.trim() || !llmConfig.absApiKeyPresent) {
        const patch: Record<string, string> = {
          absUrl: llmConfig.absUrl ?? "",
        };
        if (absKeyInput.trim()) patch.absApiKey = absKeyInput.trim();
        const res = await api.llmConfig.put(patch);
        setLlmConfig(res.config as LlmConfig);
        setAbsKeyInput("");
      } else if ((llmConfig.absUrl ?? "") !== "") {
        const res = await api.llmConfig.put({ absUrl: llmConfig.absUrl ?? "" });
        setLlmConfig(res.config as LlmConfig);
      }
      const r = await api.abs.test();
      setAbsTestResult({
        ok: r.ok,
        text: r.ok
          ? t("settings.abs.testOk", {
              user: r.username ?? "?",
              version: r.serverVersion ?? "?",
            })
          : r.message ?? t("common.error"),
      });
      if (r.ok) {
        try {
          const libs = await api.abs.libraries();
          setAbsLibraries(libs.libraries.map((l) => ({ id: l.id, name: l.name })));
        } catch {
          setAbsLibraries([]);
        }
      }
    } catch (err) {
      setAbsTestResult({
        ok: false,
        text: err instanceof Error ? err.message : t("common.error"),
      });
    } finally {
      setAbsBusy(false);
    }
  }

  async function resetGpu() {
    setGpuResetBusy(true);
    try {
      await api.admin.gpuReset();
      toast.show(t("settings.tts.resetDone"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setGpuResetBusy(false);
    }
  }

  async function reembedAll() {
    if (!confirm(t("settings.embed.reembedConfirm"))) return;
    setReembedBusy(true);
    try {
      const res = await api.rag.reembed();
      toast.show(
        t("settings.embed.reembedDone", {
          ok: res.embedded,
          failed: res.failed ?? 0,
          total: res.total,
        }),
        (res.failed ?? 0) > 0 ? "error" : "success"
      );
      // Status nachladen so the UI shows the new counts.
      const fresh = await api.rag.status();
      setRagStatus(fresh);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setReembedBusy(false);
    }
  }

  async function removeApiKey(
    provider: "anthropic" | "openai" | "google" | "qwenTts" | "abs"
  ) {
    try {
      await api.llmConfig.removeKey(provider);
      const r = await api.llmConfig.get();
      setLlmConfig(r.config);
      setOllama(r.status);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function save() {
    setSettings(s);
    // The header Save must not silently discard unsaved server-side
    // config (LLM/TTS/ABS tabs) — persist it too when dirty.
    const llmDirty =
      savedLlmConfigRef.current !== null &&
      JSON.stringify(llmConfig) !== savedLlmConfigRef.current;
    const pendingKeys =
      anthropicKeyInput.trim() ||
      openaiKeyInput.trim() ||
      googleKeyInput.trim() ||
      qwenTtsKeyInput.trim() ||
      absKeyInput.trim();
    if (llmDirty || pendingKeys) {
      await saveLlmConfig();
    }
    toast.show(t("settings.saved"), "success");
  }

  const voicesForLang = voices.filter((v) => v.language === s.defaultLanguage);

  return {
    absBusy,
    absKeyInput,
    absLibraries,
    absTest,
    absTestResult,
    anthropicKeyInput,
    backendVersion,
    doclingAlive,
    googleKeyInput,
    gpuResetBusy,
    llmBusy,
    llmConfig,
    meiliEnabled,
    ollama,
    openaiKeyInput,
    qwenTtsKeyInput,
    ragStatus,
    reembedAll,
    reembedBusy,
    removeApiKey,
    resetGpu,
    s,
    save,
    saveLlmConfig,
    savedLlmConfigRef,
    setAbsBusy,
    setAbsKeyInput,
    setAbsLibraries,
    setAbsTestResult,
    setAnthropicKeyInput,
    setBackendVersion,
    setDoclingAlive,
    setGoogleKeyInput,
    setGpuResetBusy,
    setLlmBusy,
    setLlmConfig,
    setMeiliEnabled,
    setOllama,
    setOpenaiKeyInput,
    setQwenTtsKeyInput,
    setRagStatus,
    setReembedBusy,
    setS,
    setTab,
    setVoices,
    tab,
    toast,
    voices,
    voicesForLang,
  };
}

export type SettingsCore = ReturnType<typeof useSettingsCore>;
