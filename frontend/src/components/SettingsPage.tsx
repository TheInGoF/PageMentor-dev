import { useEffect, useRef, useState } from "react";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { LogsContent } from "./LogsPage";
import { getSettings, setSettings, type Settings } from "../lib/settings";
import {
  api,
  type CustomVoiceMeta,
  type OllamaStatus,
  type PresetVisibility,
  type Voice,
  type VoiceDesignMeta,
} from "../lib/api";
import { useToast } from "./ui/Toast";
import { LOCALE_LABELS, t, useLocale, type Locale } from "../lib/i18n";

interface LlmConfig {
  ollamaUrlPc?: string;
  ollamaUrlMac?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  teiUrl?: string;
  anthropicModel?: string;
  anthropicApiKeyPresent?: boolean;
  openaiModel?: string;
  openaiApiKeyPresent?: boolean;
  googleModel?: string;
  googleApiKeyPresent?: boolean;
  qwenTtsUrl?: string;
  qwenTtsApiKeyPresent?: boolean;
  qwenTtsInstruction?: string;
  absUrl?: string;
  absApiKeyPresent?: boolean;
  absLibraryId?: string;
  qwenTtsTemperature?: string;
  qwenTtsTopP?: string;
  qwenTtsTopK?: string;
  qwenTtsRepetitionPenalty?: string;
  ttsMaxChunk?: string;
}

interface Props {
  /** Where the back-button takes the user (back to library, modules,
   *  dashboard, …). Decided by App.tsx based on previous nav state. */
  onBack: () => void;
}

type SettingsTab = "general" | "audiobook" | "tts" | "llm" | "logs";

/** Event name for "voice list has changed" — other components
 *  (audiobook picker) listen for it and reload voices. */
const VOICES_CHANGED_EVENT = "pm:voices-changed";

function notifyVoicesChanged(): void {
  window.dispatchEvent(new Event(VOICES_CHANGED_EVENT));
}

const TABS: Array<{ id: SettingsTab; labelKey: string }> = [
  { id: "general", labelKey: "settings.tab.general" },
  { id: "audiobook", labelKey: "settings.tab.audiobook" },
  { id: "tts", labelKey: "settings.tab.tts" },
  { id: "llm", labelKey: "settings.tab.llm" },
  { id: "logs", labelKey: "settings.tab.logs" },
];

/** 5%-Schritte von -10 bis +30 — programmatisch, damit das Label-Set
 *  konsistent zu Audiobook.tsx bleibt. */
const RATES: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let pct = -10; pct <= 30; pct += 5) {
    if (pct === 0) out.push({ value: "+0%", label: "Normal" });
    else if (pct > 0) out.push({ value: `+${pct}%`, label: `+${pct} %` });
    else out.push({ value: `${pct}%`, label: `−${Math.abs(pct)} %` });
  }
  return out;
})();

export function SettingsPage({ onBack }: Props) {
  useLocale();
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
  // Single active voice-preview element: starting a new preview stops
  // the previous one, and unmount stops whatever is still playing.
  const activePreviewRef = useRef<HTMLAudioElement | null>(null);
  function stopActivePreview() {
    const a = activePreviewRef.current;
    if (a) {
      a.pause();
      activePreviewRef.current = null;
    }
  }
  useEffect(() => stopActivePreview, []);
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
  const [customVoices, setCustomVoices] = useState<CustomVoiceMeta[]>([]);
  const [voiceUploadBusy, setVoiceUploadBusy] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<{
    label: string;
    gender: "female" | "male";
    refText: string;
    file: File | null;
  }>({ label: "", gender: "female", refText: "", file: null });
  const [voiceDesigns, setVoiceDesigns] = useState<VoiceDesignMeta[]>([]);
  const [presetVisibility, setPresetVisibility] = useState<PresetVisibility[]>(
    []
  );
  // Edit-modal state. Mutually exclusive — only one voice can be
  // edited at a time. We hold a copy of the form fields locally so
  // the user can cancel without dirty-state leakage into the list.
  const [editSample, setEditSample] = useState<{
    id: string;
    label: string;
    gender: "female" | "male";
    language: string;
    refText: string;
    instruct: string;
  } | null>(null);
  const [editDesign, setEditDesign] = useState<{
    id: string;
    label: string;
    gender: "female" | "male";
    language: string;
    description: string;
  } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [designDraft, setDesignDraft] = useState<{
    label: string;
    gender: "female" | "male";
    language: "de" | "en";
    description: string;
    seed: string;
  }>({
    label: "",
    gender: "female",
    language: "de",
    description: "",
    seed: "",
  });
  const [designBusy, setDesignBusy] = useState(false);
  const [designPreviewUrl, setDesignPreviewUrl] = useState<string | null>(null);
  const [designPreviewSeed, setDesignPreviewSeed] = useState<number | null>(null);
  const [designPreviewBlob, setDesignPreviewBlob] = useState<Blob | null>(null);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [llmBusy, setLlmBusy] = useState(false);
  const [gpuResetBusy, setGpuResetBusy] = useState(false);
  const [previewVoiceId, setPreviewVoiceId] = useState<string>("");
  const [previewLang, setPreviewLang] = useState<"de" | "en">("de");
  const [previewText, setPreviewText] = useState<string>("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
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
        // Default selection for the preset tester: first preset voice
        // of the current language, otherwise the first preset voice
        // at all. Only set when still empty — otherwise we'd overwrite
        // the user's choice.
        setPreviewVoiceId((prev) => {
          if (prev) return prev;
          const presets = r.voices.filter((v) => v.id.startsWith("preset:"));
          const lang = getSettings().defaultLanguage;
          return (
            presets.find((v) => v.language === lang)?.id ??
            presets[0]?.id ??
            ""
          );
        });
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
        if (r.config.absUrl && r.config.absApiKeyPresent) {
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
    setGoogleKeyInput("");
    setQwenTtsKeyInput("");
    api.customVoices
      .list()
      .then((r) => setCustomVoices(r.voices))
      .catch(() => setCustomVoices([]));
    api.voiceDesigns
      .list()
      .then((r) => setVoiceDesigns(r.voices))
      .catch(() => setVoiceDesigns([]));
    api.voiceDesigns
      .listPresetVisibility()
      .then((r) => setPresetVisibility(r.presets))
      .catch(() => setPresetVisibility([]));
    // Mount-only: this is a full page (not a modal) — it loads its
    // data once when opened.
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
  // preview blob leaks in memory.
  useEffect(() => {
    return () => {
      if (previewAudioUrl) URL.revokeObjectURL(previewAudioUrl);
    };
  }, [previewAudioUrl]);

  useEffect(() => {
    return () => {
      if (designPreviewUrl) URL.revokeObjectURL(designPreviewUrl);
    };
  }, [designPreviewUrl]);

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

  async function uploadVoiceSample() {
    if (!voiceDraft.file || !voiceDraft.label.trim()) {
      toast.show(t("settings.voices.missingFields"), "error");
      return;
    }
    setVoiceUploadBusy(true);
    try {
      await api.customVoices.upload({
        label: voiceDraft.label.trim(),
        gender: voiceDraft.gender,
        refText: voiceDraft.refText.trim() || undefined,
        file: voiceDraft.file,
      });
      const r = await api.customVoices.list();
      setCustomVoices(r.voices);
      setVoiceDraft({ label: "", gender: "female", refText: "", file: null });
      notifyVoicesChanged();
      toast.show(t("settings.voices.uploaded"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setVoiceUploadBusy(false);
    }
  }

  async function deleteVoiceSample(id: string, label: string) {
    if (!confirm(t("settings.voices.deleteConfirm", { label }))) return;
    try {
      await api.customVoices.remove(id);
      setCustomVoices((prev) => prev.filter((v) => v.id !== id));
      notifyVoicesChanged();
      toast.show(t("settings.voices.deleted"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  function playVoicePreview(id: string) {
    const url = api.customVoices.previewUrl(id);
    stopActivePreview();
    const audio = new Audio(url);
    activePreviewRef.current = audio;
    audio.play().catch(() =>
      toast.show(t("settings.voices.previewFailed"), "error")
    );
  }

  /** Rolls a new preview with a random seed (or the one entered in
   *  the input field, if any). Sets designPreviewSeed to the seed
   *  actually used — saveDesign() then reads from it. */
  async function previewDesign(mode: "fresh" | "useInputSeed") {
    if (designDraft.description.trim().length < 10) {
      toast.show(t("settings.design.descTooShort"), "error");
      return;
    }
    setDesignBusy(true);
    try {
      const inputSeed =
        mode === "useInputSeed" && designDraft.seed.trim()
          ? parseInt(designDraft.seed.trim(), 10)
          : undefined;
      const { blob, seed } = await api.voiceDesigns.previewUnsaved({
        description: designDraft.description.trim(),
        gender: designDraft.gender,
        language: designDraft.language,
        seed: Number.isFinite(inputSeed) ? inputSeed : undefined,
      });
      const url = URL.createObjectURL(blob);
      setDesignPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setDesignPreviewSeed(seed);
      // Remember the blob for save — so the saved voice sounds
      // EXACTLY like the preview just heard (Qwen VoiceDesign is
      // not deterministic, regen would diverge).
      setDesignPreviewBlob(blob);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setDesignBusy(false);
    }
  }

  /** Persists the current voice with the last-previewed seed. */
  async function saveDesign() {
    if (!designDraft.label.trim() || designDraft.description.trim().length < 10) {
      toast.show(t("settings.design.missingFields"), "error");
      return;
    }
    if (designPreviewSeed === null) {
      toast.show(t("settings.design.previewFirst"), "error");
      return;
    }
    setDesignBusy(true);
    try {
      await api.voiceDesigns.create({
        label: designDraft.label.trim(),
        gender: designDraft.gender,
        language: designDraft.language,
        description: designDraft.description.trim(),
        seed: designPreviewSeed,
        // Send the blob along — backend stores it as reference
        // audio and uses it from now on for all synthesis calls via
        // base clone (stable voice across all audiobook chunks).
        refBlob: designPreviewBlob ?? undefined,
      });
      const r = await api.voiceDesigns.list();
      setVoiceDesigns(r.voices);
      setDesignDraft({
        label: "",
        gender: "female",
        language: designDraft.language,
        description: "",
        seed: "",
      });
      if (designPreviewUrl) URL.revokeObjectURL(designPreviewUrl);
      setDesignPreviewUrl(null);
      setDesignPreviewSeed(null);
      setDesignPreviewBlob(null);
      notifyVoicesChanged();
      toast.show(t("settings.design.created"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setDesignBusy(false);
    }
  }

  async function deleteDesign(id: string, label: string) {
    if (!confirm(t("settings.design.deleteConfirm", { label }))) return;
    try {
      await api.voiceDesigns.remove(id);
      setVoiceDesigns((prev) => prev.filter((v) => v.id !== id));
      notifyVoicesChanged();
      toast.show(t("settings.design.deleted"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function regenerateDesignReference(id: string, label: string) {
    if (!confirm(t("settings.design.regenRefConfirm", { label }))) return;
    setDesignBusy(true);
    try {
      await api.voiceDesigns.regenerateReference(id);
      notifyVoicesChanged();
      toast.show(t("settings.design.regenRefDone"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setDesignBusy(false);
    }
  }

  /** Toggle whether a designed voice appears in the audiobook tab's
   *  voice picker. Optimistic UI update + persistence in one go. */
  async function toggleDesignVisibility(id: string, show: boolean) {
    setVoiceDesigns((prev) =>
      prev.map((v) => (v.id === id ? { ...v, showInAudiobook: show } : v))
    );
    try {
      await api.voiceDesigns.setVisibility(id, show);
      notifyVoicesChanged();
    } catch (err) {
      // Roll back on failure.
      setVoiceDesigns((prev) =>
        prev.map((v) =>
          v.id === id ? { ...v, showInAudiobook: !show } : v
        )
      );
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  /** Toggle a single preset voice in/out of the audiobook picker.
   *  Sends the full visible-list to the backend (replace semantics). */
  async function togglePresetVisibility(voiceId: string, show: boolean) {
    const next = presetVisibility.map((p) =>
      p.voice.id === voiceId ? { ...p, visible: show } : p
    );
    setPresetVisibility(next);
    const visibleIds = next.filter((p) => p.visible).map((p) => p.voice.id);
    try {
      await api.voiceDesigns.setPresetVisibility(visibleIds);
      notifyVoicesChanged();
    } catch (err) {
      // Roll back on failure.
      setPresetVisibility((prev) =>
        prev.map((p) =>
          p.voice.id === voiceId ? { ...p, visible: !show } : p
        )
      );
      toast.show(
        err instanceof Error ? err.message : t("settings.presets.saveFailed"),
        "error"
      );
    }
  }

  /** Same for user-uploaded voice samples. */
  async function toggleCustomVisibility(id: string, show: boolean) {
    setCustomVoices((prev) =>
      prev.map((v) => (v.id === id ? { ...v, showInAudiobook: show } : v))
    );
    try {
      await api.customVoices.setVisibility(id, show);
      notifyVoicesChanged();
    } catch (err) {
      setCustomVoices((prev) =>
        prev.map((v) =>
          v.id === id ? { ...v, showInAudiobook: !show } : v
        )
      );
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  function playDesignPreview(id: string) {
    stopActivePreview();
    const audio = new Audio(api.voiceDesigns.previewUrl(id));
    activePreviewRef.current = audio;
    audio.play().catch(() =>
      toast.show(t("settings.design.previewFailed"), "error")
    );
  }

  function openSampleEdit(v: CustomVoiceMeta) {
    setEditSample({
      id: v.id,
      label: v.label,
      gender: v.gender,
      language: v.language,
      refText: v.refText ?? "",
      instruct: v.instruct ?? "",
    });
  }

  function openDesignEdit(v: VoiceDesignMeta) {
    setEditDesign({
      id: v.id,
      label: v.label,
      gender: v.gender,
      language: v.language,
      description: v.description,
    });
  }

  async function saveSampleEdit() {
    if (!editSample) return;
    setEditBusy(true);
    try {
      await api.customVoices.update(editSample.id, {
        label: editSample.label,
        gender: editSample.gender,
        language: editSample.language,
        refText: editSample.refText.trim() || null,
        instruct: editSample.instruct.trim() || null,
      });
      const r = await api.customVoices.list();
      setCustomVoices(r.voices);
      notifyVoicesChanged();
      setEditSample(null);
      toast.show(t("common.saved"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setEditBusy(false);
    }
  }

  async function saveDesignEdit() {
    if (!editDesign) return;
    setEditBusy(true);
    try {
      await api.voiceDesigns.update(editDesign.id, {
        label: editDesign.label,
        gender: editDesign.gender,
        language: editDesign.language,
        description: editDesign.description,
      });
      const r = await api.voiceDesigns.list();
      setVoiceDesigns(r.voices);
      notifyVoicesChanged();
      setEditDesign(null);
      toast.show(t("common.saved"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setEditBusy(false);
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
    onBack();
  }

  const voicesForLang = voices.filter((v) => v.language === s.defaultLanguage);

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Page header — sticky so the title + actions stay visible
          while the user scrolls through the long settings form. */}
      <header className="sticky top-0 z-30 bg-bg-elevated border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-3">
          <Button variant="ghost" onClick={onBack} aria-label={t("common.back")}>
            ← {t("common.back")}
          </Button>
          <h1 className="text-base font-semibold flex-1 truncate">
            {t("settings.title")}
          </h1>
          <Button variant="ghost" onClick={onBack}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save}>{t("common.save")}</Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex gap-4 -mx-1">
        <nav className="w-40 shrink-0 flex flex-col gap-1 pr-2 border-r border-border">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={
                "text-left text-sm px-3 py-2 rounded transition-colors " +
                (tab === item.id
                  ? "bg-accent/15 text-accent"
                  : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/60")
              }
            >
              {t(item.labelKey)}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 flex flex-col gap-5">
        {tab === "general" && (
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
        )}

        {tab === "general" && (
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
        )}

        {tab === "audiobook" && (
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
            <p className="text-[11px] text-neutral-500">
              {t("settings.abs.subtitle")}
            </p>
            <Input
              label={t("settings.abs.url")}
              type="url"
              value={llmConfig.absUrl ?? ""}
              onChange={(e) =>
                setLlmConfig({ ...llmConfig, absUrl: e.target.value })
              }
              placeholder="http://192.168.188.5:13378"
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
            <p className="text-[11px] text-neutral-500">
              {t("settings.abs.hint")}
            </p>

            <Button onClick={saveLlmConfig} disabled={llmBusy}>
              {llmBusy ? t("common.saving") : t("settings.llm.save")}
            </Button>
          </div>
        </section>
        )}

        {tab === "general" && (
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
        )}

        {tab === "llm" && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.llm.title")}
          </h3>
          <p className="text-[11px] text-neutral-500">{t("settings.llm.subtitle")}</p>

          <div className="text-xs">
            {ollama?.available ? (
              <span className="text-emerald-400">
                ✓ {t("settings.llm.active", { label: ollama.label ?? ollama.url })}
              </span>
            ) : (
              <span className="text-accent">✗ {t("settings.llm.inactive")}</span>
            )}
            {ollama?.candidates && (
              <span className="text-neutral-500 ml-2">
                · {t("settings.llm.candidates", { n: ollama.candidates.length })}
              </span>
            )}
          </div>

          <Input
            label={t("settings.llm.ollamaUrlPc")}
            type="url"
            value={llmConfig.ollamaUrlPc ?? ""}
            onChange={(e) => setLlmConfig({ ...llmConfig, ollamaUrlPc: e.target.value })}
            placeholder="http://192.168.1.100:11434"
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
            placeholder="http://ollama:11434"
          />
          <Input
            label={t("settings.llm.ollamaModel")}
            value={llmConfig.ollamaModel ?? ""}
            onChange={(e) => setLlmConfig({ ...llmConfig, ollamaModel: e.target.value })}
            placeholder="auto"
          />
          <Input
            label={t("settings.llm.teiUrl")}
            type="url"
            value={llmConfig.teiUrl ?? ""}
            onChange={(e) => setLlmConfig({ ...llmConfig, teiUrl: e.target.value })}
            placeholder="http://192.168.188.6:8080"
          />

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

          <Button onClick={saveLlmConfig} disabled={llmBusy}>
            {llmBusy ? t("common.saving") : t("settings.llm.save")}
          </Button>

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
                <p className="text-[11px] text-neutral-500">
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
                <p className="text-[11px] text-neutral-500">
                  {t("settings.embed.stats", {
                    embedded: ragStatus.embedded,
                    total: ragStatus.total,
                    docs: ragStatus.documents,
                  })}
                </p>
              ) : (
                <p className="text-[11px] text-neutral-500">
                  {t("settings.embed.statsLoading")}
                </p>
              )}
              <p className="text-[11px] text-neutral-500">
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
        )}

        {tab === "tts" && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.tts.title")}
          </h3>
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-neutral-300 sr-only">
              {t("settings.tts.title")}
            </h4>
            <p className="text-[11px] text-neutral-500">
              {t("settings.tts.subtitle")}
            </p>
            <Input
              label={t("settings.tts.qwenTtsUrl")}
              type="url"
              value={llmConfig.qwenTtsUrl ?? ""}
              onChange={(e) =>
                setLlmConfig({ ...llmConfig, qwenTtsUrl: e.target.value })
              }
              placeholder="http://192.168.1.50:8790"
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
              <p className="text-[11px] text-neutral-500 flex-1">
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
              <p className="text-[11px] text-neutral-500">
                {t("settings.tts.instructionHint")}
              </p>
            </div>

            <div className="pt-3 border-t border-border flex flex-col gap-2">
              <h4 className="text-xs font-semibold text-neutral-300">
                {t("settings.tts.tester.title")}
              </h4>
              <p className="text-[11px] text-neutral-500">
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
                      <p className="text-[11px] text-red-400 pt-2">
                        {t("settings.tts.advanced.chunkSizeOutOfRange")}
                      </p>
                    );
                  }
                  return null;
                })()}
                <p className="text-[11px] text-neutral-500 pt-2">
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
                <span className="text-[11px] text-neutral-500">
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

          <Button onClick={saveLlmConfig} disabled={llmBusy}>
            {llmBusy ? t("common.saving") : t("settings.llm.save")}
          </Button>
        </section>
        )}

        {tab === "tts" && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.voices.title")}
          </h3>
          <p className="text-[11px] text-neutral-500">
            {t("settings.voices.subtitle")}
          </p>

          {customVoices.length === 0 ? (
            <p className="text-xs text-neutral-500 italic">
              {t("settings.voices.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {customVoices.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center gap-3 card p-3 bg-bg-elevated"
                >
                  <span className="text-base leading-none">
                    {v.gender === "female" ? "♀" : "♂"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-neutral-100 truncate">
                      {v.label}
                    </div>
                    <div className="text-[10px] text-neutral-500 font-mono">
                      {v.language} · seed {v.seed} ·{" "}
                      {(v.bytes / 1024).toFixed(0)} KB
                      {v.refTextPresent && ` · ${t("settings.voices.withTranscript")}`}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      toggleCustomVisibility(v.id, !(v.showInAudiobook ?? true))
                    }
                    title={t(
                      v.showInAudiobook === false
                        ? "settings.voices.unhide"
                        : "settings.voices.hide"
                    )}
                    aria-label={t(
                      v.showInAudiobook === false
                        ? "settings.voices.unhide"
                        : "settings.voices.hide"
                    )}
                  >
                    {v.showInAudiobook === false ? "🙈" : "👁"}
                  </Button>
                  <Button variant="ghost" onClick={() => playVoicePreview(v.id)}>
                    {t("settings.voices.preview")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => openSampleEdit(v)}
                    title={t("common.edit")}
                    aria-label={t("common.edit")}
                  >
                    ✏️
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => deleteVoiceSample(v.id, v.label)}
                  >
                    {t("common.delete")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="card p-3 flex flex-col gap-2 bg-bg-elevated">
            <h4 className="text-xs font-semibold text-neutral-300">
              {t("settings.voices.uploadTitle")}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
              <Input
                label={t("settings.voices.label")}
                value={voiceDraft.label}
                onChange={(e) =>
                  setVoiceDraft({ ...voiceDraft, label: e.target.value })
                }
                placeholder={t("settings.voices.labelPlaceholder")}
              />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.voices.gender")}
                </label>
                <select
                  className="input"
                  value={voiceDraft.gender}
                  onChange={(e) =>
                    setVoiceDraft({
                      ...voiceDraft,
                      gender: e.target.value as "female" | "male",
                    })
                  }
                >
                  <option value="female">♀ {t("settings.voices.female")}</option>
                  <option value="male">♂ {t("settings.voices.male")}</option>
                </select>
              </div>
            </div>
            <Input
              label={t("settings.voices.refText")}
              value={voiceDraft.refText}
              onChange={(e) =>
                setVoiceDraft({ ...voiceDraft, refText: e.target.value })
              }
              placeholder={t("settings.voices.refTextPlaceholder")}
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.voices.file")}
              </label>
              <input
                type="file"
                accept="audio/wav,audio/mpeg,audio/mp3,audio/flac,audio/ogg,audio/mp4,audio/x-m4a,.wav,.mp3,.flac,.ogg,.m4a"
                onChange={(e) =>
                  setVoiceDraft({
                    ...voiceDraft,
                    file: e.target.files?.[0] ?? null,
                  })
                }
                className="text-xs text-neutral-400"
              />
              <p className="text-[10px] text-neutral-500">
                {t("settings.voices.fileHint")}
              </p>
            </div>
            <Button
              onClick={uploadVoiceSample}
              disabled={
                voiceUploadBusy || !voiceDraft.label.trim() || !voiceDraft.file
              }
            >
              {voiceUploadBusy
                ? t("settings.voices.uploading")
                : t("settings.voices.upload")}
            </Button>
          </div>
        </section>
        )}

        {tab === "tts" && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.design.title")}
          </h3>
          <p className="text-[11px] text-neutral-500">
            {t("settings.design.subtitle")}
          </p>

          {voiceDesigns.length === 0 ? (
            <p className="text-xs text-neutral-500 italic">
              {t("settings.design.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {voiceDesigns.map((v) => (
                <li
                  key={v.id}
                  className="card p-3 bg-bg-elevated flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 sm:flex-1">
                    <span className="text-base leading-none">
                      {v.gender === "female" ? "♀" : "♂"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-neutral-100 truncate">
                        {v.label}
                      </div>
                      <div className="text-[10px] text-neutral-500 truncate">
                        {v.description}
                      </div>
                      <div className="text-[10px] text-neutral-600 font-mono">
                        {v.language} · seed {v.seed}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-1 sm:flex-none">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        toggleDesignVisibility(v.id, !(v.showInAudiobook ?? true))
                      }
                      title={t(
                        v.showInAudiobook === false
                          ? "settings.voices.unhide"
                          : "settings.voices.hide"
                      )}
                      aria-label={t(
                        v.showInAudiobook === false
                          ? "settings.voices.unhide"
                          : "settings.voices.hide"
                      )}
                    >
                      {v.showInAudiobook === false ? "🙈" : "👁"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => playDesignPreview(v.id)}
                      title={t("settings.voices.preview")}
                      aria-label={t("settings.voices.preview")}
                    >
                      ▶
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => regenerateDesignReference(v.id, v.label)}
                      disabled={designBusy}
                      title={t("settings.design.regenRefTooltip")}
                      aria-label={t("settings.design.regenRef")}
                    >
                      ↻
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => openDesignEdit(v)}
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                    >
                      ✏️
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => deleteDesign(v.id, v.label)}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      ×
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="card p-3 flex flex-col gap-2 bg-bg-elevated">
            <h4 className="text-xs font-semibold text-neutral-300">
              {t("settings.design.createTitle")}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
              <Input
                label={t("settings.design.label")}
                value={designDraft.label}
                onChange={(e) =>
                  setDesignDraft({ ...designDraft, label: e.target.value })
                }
                placeholder={t("settings.design.labelPlaceholder")}
              />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.design.gender")}
                </label>
                <select
                  className="input"
                  value={designDraft.gender}
                  onChange={(e) =>
                    setDesignDraft({
                      ...designDraft,
                      gender: e.target.value as "female" | "male",
                    })
                  }
                >
                  <option value="female">♀ {t("settings.voices.female")}</option>
                  <option value="male">♂ {t("settings.voices.male")}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.design.language")}
                </label>
                <select
                  className="input"
                  value={designDraft.language}
                  onChange={(e) =>
                    setDesignDraft({
                      ...designDraft,
                      language: e.target.value as "de" | "en",
                    })
                  }
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.design.description")}
              </label>
              <textarea
                className="input min-h-[80px] resize-y"
                value={designDraft.description}
                onChange={(e) =>
                  setDesignDraft({ ...designDraft, description: e.target.value })
                }
                placeholder={t("settings.design.descriptionPlaceholder")}
              />
              <p className="text-[11px] text-neutral-500">
                {t("settings.design.descriptionHint")}
              </p>
            </div>
            <Input
              label={t("settings.design.seed")}
              type="number"
              step="1"
              value={designDraft.seed}
              onChange={(e) =>
                setDesignDraft({ ...designDraft, seed: e.target.value })
              }
              placeholder={t("settings.design.seedPlaceholder")}
            />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => previewDesign("fresh")}
                disabled={
                  designBusy || designDraft.description.trim().length < 10
                }
              >
                {designBusy
                  ? t("settings.design.previewBusy")
                  : designPreviewSeed === null
                  ? t("settings.design.previewFirst.button")
                  : t("settings.design.reroll")}
              </Button>
              {designDraft.seed.trim() && (
                <Button
                  variant="ghost"
                  onClick={() => previewDesign("useInputSeed")}
                  disabled={designBusy}
                >
                  {t("settings.design.previewInputSeed")}
                </Button>
              )}
              {designPreviewSeed !== null && (
                <span className="text-[11px] text-neutral-500 font-mono">
                  {t("settings.design.currentSeed", {
                    seed: String(designPreviewSeed),
                  })}
                </span>
              )}
            </div>

            {designPreviewUrl && (
              <audio
                controls
                src={designPreviewUrl}
                className="w-full mt-1"
                autoPlay
              />
            )}

            <Button
              onClick={saveDesign}
              disabled={
                designBusy ||
                !designDraft.label.trim() ||
                designDraft.description.trim().length < 10 ||
                designPreviewSeed === null
              }
            >
              {designBusy
                ? t("settings.design.creating")
                : t("settings.design.saveThisVoice")}
            </Button>
          </div>
        </section>
        )}

        {tab === "tts" && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.presets.title")}
          </h3>
          <p className="text-[11px] text-neutral-500">
            {t("settings.presets.subtitle")}
          </p>

          {presetVisibility.length === 0 ? (
            <p className="text-xs text-neutral-500 italic">
              {t("settings.presets.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {presetVisibility.map((p) => (
                <li
                  key={p.voice.id}
                  className="flex items-center gap-3 card p-3 bg-bg-elevated"
                >
                  <span className="text-base leading-none">
                    {p.voice.gender === "female" ? "♀" : "♂"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-neutral-100 truncate">
                      {p.voice.label}
                    </div>
                    <div className="text-[10px] text-neutral-500 font-mono truncate">
                      {p.voice.language}
                      {p.voice.engine ? ` · ${p.voice.engine}` : ""}
                      {" · "}
                      {p.voice.id}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      togglePresetVisibility(p.voice.id, !p.visible)
                    }
                    title={t(
                      p.visible
                        ? "settings.voices.hide"
                        : "settings.voices.unhide"
                    )}
                    aria-label={t(
                      p.visible
                        ? "settings.voices.hide"
                        : "settings.voices.unhide"
                    )}
                  >
                    {p.visible ? "👁" : "🙈"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        )}

        {tab === "general" && (
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
            <StatusRow
              label="Docling"
              ok={doclingAlive === true}
              waiting={doclingAlive === null}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-2 mt-1 border-t border-border/50">
            <span>{t("settings.backendVersion")}</span>
            <code className="font-mono text-neutral-300">
              {backendVersion ?? "—"}
            </code>
          </div>
        </section>
        )}

        {tab === "logs" && (
        <section className="flex flex-col gap-3">
          <LogsContent />
        </section>
        )}
          </div>
        </div>
        </div>
      </main>

      <Modal
        open={!!editSample}
        onClose={() => !editBusy && setEditSample(null)}
        title={t("settings.voices.editTitle")}
        size="xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditSample(null)}
              disabled={editBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={saveSampleEdit} disabled={editBusy}>
              {editBusy ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        }
      >
        {editSample && (
          <div className="flex flex-col gap-3">
            <Input
              label={t("settings.voices.label")}
              value={editSample.label}
              onChange={(e) =>
                setEditSample({ ...editSample, label: e.target.value })
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.voices.gender")}
                </label>
                <select
                  className="input"
                  value={editSample.gender}
                  onChange={(e) =>
                    setEditSample({
                      ...editSample,
                      gender: e.target.value as "female" | "male",
                    })
                  }
                >
                  <option value="female">♀ {t("settings.voices.female")}</option>
                  <option value="male">♂ {t("settings.voices.male")}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.design.language")}
                </label>
                <select
                  className="input"
                  value={editSample.language}
                  onChange={(e) =>
                    setEditSample({ ...editSample, language: e.target.value })
                  }
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.voices.refText")}
              </label>
              <textarea
                className="input min-h-[60px] resize-y"
                value={editSample.refText}
                onChange={(e) =>
                  setEditSample({ ...editSample, refText: e.target.value })
                }
                placeholder={t("settings.voices.refTextPlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.voices.instruct")}
              </label>
              <textarea
                className="input min-h-[80px] resize-y"
                value={editSample.instruct}
                onChange={(e) =>
                  setEditSample({ ...editSample, instruct: e.target.value })
                }
                placeholder={t("settings.voices.instructPlaceholder")}
              />
              <p className="text-[11px] text-neutral-500">
                {t("settings.voices.instructHint")}
              </p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editDesign}
        onClose={() => !editBusy && setEditDesign(null)}
        title={t("settings.design.editTitle")}
        size="xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditDesign(null)}
              disabled={editBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={saveDesignEdit} disabled={editBusy}>
              {editBusy ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        }
      >
        {editDesign && (
          <div className="flex flex-col gap-3">
            <Input
              label={t("settings.design.label")}
              value={editDesign.label}
              onChange={(e) =>
                setEditDesign({ ...editDesign, label: e.target.value })
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.design.gender")}
                </label>
                <select
                  className="input"
                  value={editDesign.gender}
                  onChange={(e) =>
                    setEditDesign({
                      ...editDesign,
                      gender: e.target.value as "female" | "male",
                    })
                  }
                >
                  <option value="female">♀ {t("settings.voices.female")}</option>
                  <option value="male">♂ {t("settings.voices.male")}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.design.language")}
                </label>
                <select
                  className="input"
                  value={editDesign.language}
                  onChange={(e) =>
                    setEditDesign({ ...editDesign, language: e.target.value })
                  }
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.design.description")}
              </label>
              <textarea
                className="input min-h-[120px] resize-y"
                value={editDesign.description}
                onChange={(e) =>
                  setEditDesign({
                    ...editDesign,
                    description: e.target.value,
                  })
                }
              />
              <p className="text-[11px] text-neutral-500">
                {t("settings.design.editDescHint")}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ApiProviderBlock(props: {
  label: string;
  placeholder: string;
  keyPresent: boolean;
  keyInput: string;
  onKeyChange: (v: string) => void;
  onRemove: () => void;
  modelLabel: string;
  modelPlaceholder: string;
  modelValue: string;
  onModelChange: (v: string) => void;
}) {
  return (
    <div className="pt-3 border-t border-border flex flex-col gap-2">
      <Input
        label={props.label}
        type="password"
        value={props.keyInput}
        onChange={(e) => props.onKeyChange(e.target.value)}
        placeholder={props.placeholder}
      />
      {props.keyPresent && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-neutral-500">
            🔒 {t("settings.llm.anthropicKeyStored")}
          </span>
          <Button
            variant="danger"
            onClick={props.onRemove}
            className="!px-2 !py-1 text-xs"
          >
            {t("settings.llm.anthropicRemove")}
          </Button>
        </div>
      )}
      <Input
        label={props.modelLabel}
        value={props.modelValue}
        onChange={(e) => props.onModelChange(e.target.value)}
        placeholder={props.modelPlaceholder}
      />
    </div>
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
