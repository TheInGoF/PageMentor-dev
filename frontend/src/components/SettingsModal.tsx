import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { getSettings, setSettings, type Settings } from "../lib/settings";
import {
  api,
  type CustomVoiceMeta,
  type OllamaStatus,
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
  anthropicModel?: string;
  anthropicApiKeyPresent?: boolean;
  openaiModel?: string;
  openaiApiKeyPresent?: boolean;
  googleModel?: string;
  googleApiKeyPresent?: boolean;
  qwenTtsUrl?: string;
  qwenTtsApiKeyPresent?: boolean;
  qwenTtsInstruction?: string;
  qwenTtsTemperature?: string;
  qwenTtsTopP?: string;
  qwenTtsMaxNewTokens?: string;
  qwenTtsSeedOverride?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "general" | "audiobook" | "tts" | "llm" | "ai";

/** Event-Name für "Voice-Liste hat sich geändert" — andere Komponenten
 *  (Audiobook-Picker) hören darauf und laden Voices nach. */
const VOICES_CHANGED_EVENT = "pm:voices-changed";

function notifyVoicesChanged(): void {
  window.dispatchEvent(new Event(VOICES_CHANGED_EVENT));
}

const TABS: Array<{ id: SettingsTab; labelKey: string }> = [
  { id: "general", labelKey: "settings.tab.general" },
  { id: "audiobook", labelKey: "settings.tab.audiobook" },
  { id: "tts", labelKey: "settings.tab.tts" },
  { id: "llm", labelKey: "settings.tab.llm" },
  { id: "ai", labelKey: "settings.tab.ai" },
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

export function SettingsModal({ open, onClose }: Props) {
  useLocale();
  const [s, setS] = useState<Settings>(getSettings());
  const [voices, setVoices] = useState<Voice[]>([]);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [meiliEnabled, setMeiliEnabled] = useState<boolean | null>(null);
  const [doclingAlive, setDoclingAlive] = useState<boolean | null>(null);
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
  const [anthropicKeyInput, setAnthropicKeyInput] = useState("");
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [googleKeyInput, setGoogleKeyInput] = useState("");
  const [qwenTtsKeyInput, setQwenTtsKeyInput] = useState("");
  const [customVoices, setCustomVoices] = useState<CustomVoiceMeta[]>([]);
  const [voiceUploadBusy, setVoiceUploadBusy] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<{
    label: string;
    gender: "female" | "male";
    refText: string;
    file: File | null;
  }>({ label: "", gender: "female", refText: "", file: null });
  const [voiceDesigns, setVoiceDesigns] = useState<VoiceDesignMeta[]>([]);
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
    if (!open) return;
    setS(getSettings());
    api.audio
      .voices()
      .then((r) => {
        setVoices(r.voices);
        // Default-Auswahl für den Preset-Tester: erste Preset-Voice der
        // aktuellen Sprache, sonst erste Preset-Voice überhaupt. Nur
        // setzen wenn noch leer — sonst überschreiben wir die User-Wahl.
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
        setOllama(r.status);
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
  }, [open]);

  async function saveLlmConfig() {
    setLlmBusy(true);
    try {
      const patch: Record<string, string | undefined> = {
        ollamaUrlPc: llmConfig.ollamaUrlPc ?? "",
        ollamaUrlMac: llmConfig.ollamaUrlMac ?? "",
        ollamaUrl: llmConfig.ollamaUrl ?? "",
        ollamaModel: llmConfig.ollamaModel ?? "",
        anthropicModel: llmConfig.anthropicModel ?? "",
        openaiModel: llmConfig.openaiModel ?? "",
        googleModel: llmConfig.googleModel ?? "",
        qwenTtsUrl: llmConfig.qwenTtsUrl ?? "",
        qwenTtsInstruction: llmConfig.qwenTtsInstruction ?? "",
        qwenTtsTemperature: llmConfig.qwenTtsTemperature ?? "",
        qwenTtsTopP: llmConfig.qwenTtsTopP ?? "",
        qwenTtsMaxNewTokens: llmConfig.qwenTtsMaxNewTokens ?? "",
        qwenTtsSeedOverride: llmConfig.qwenTtsSeedOverride ?? "",
      };
      if (anthropicKeyInput.trim()) patch.anthropicApiKey = anthropicKeyInput.trim();
      if (openaiKeyInput.trim()) patch.openaiApiKey = openaiKeyInput.trim();
      if (googleKeyInput.trim()) patch.googleApiKey = googleKeyInput.trim();
      if (qwenTtsKeyInput.trim()) patch.qwenTtsApiKey = qwenTtsKeyInput.trim();
      const res = await api.llmConfig.put(patch);
      setLlmConfig(res.config as LlmConfig);
      setOllama(res.status);
      setAnthropicKeyInput("");
      setOpenaiKeyInput("");
      setGoogleKeyInput("");
      setQwenTtsKeyInput("");
      toast.show(t("settings.llm.saved"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setLlmBusy(false);
    }
  }

  // Blob-URL beim Unmount / Modal-Close aufräumen, sonst leakt der
  // Preview-Blob im Speicher.
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
    // Default-Text pro Sprache, nur solange der User noch nichts
    // Eigenes getippt hat.
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
        // Aktueller Form-State — inklusive unsaved Änderungen, damit
        // der User sofort hört was er getippt hat ohne zuerst speichern
        // zu müssen.
        instruct: llmConfig.qwenTtsInstruction ?? "",
        temperature: llmConfig.qwenTtsTemperature || undefined,
        topP: llmConfig.qwenTtsTopP || undefined,
        maxNewTokens: llmConfig.qwenTtsMaxNewTokens || undefined,
        seed: llmConfig.qwenTtsSeedOverride || undefined,
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
    provider: "anthropic" | "openai" | "google" | "qwenTts"
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
    const audio = new Audio(url);
    audio.play().catch(() =>
      toast.show(t("settings.voices.previewFailed"), "error")
    );
  }

  /** Rollt einen neuen Preview mit zufälligem Seed (oder dem im Input
   *  gesetzten, falls einer drinsteht). Setzt designPreviewSeed auf den
   *  tatsächlich verwendeten Seed — davon liest dann saveDesign(). */
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
      // Blob für Save merken — damit die gespeicherte Voice EXAKT so
      // klingt wie das gerade angehörte Preview (Qwen VoiceDesign ist
      // nicht deterministisch, Re-Generate würde abweichen).
      setDesignPreviewBlob(blob);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setDesignBusy(false);
    }
  }

  /** Persistiert die aktuelle Voice mit dem zuletzt gepreviewten Seed. */
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
        // Blob mitsenden — Backend speichert ihn als Referenz-Audio
        // und nutzt ihn ab jetzt für alle Synthese-Calls über Base-
        // Clone (stabile Stimme über alle Hörbuch-Chunks).
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

  function playDesignPreview(id: string) {
    const audio = new Audio(api.voiceDesigns.previewUrl(id));
    audio.play().catch(() =>
      toast.show(t("settings.design.previewFailed"), "error")
    );
  }

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
      size="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save}>{t("common.save")}</Button>
        </>
      }
    >
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
                      // Voice an neue Sprache anpassen wenn die bisherige
                      // für die neue Sprache nicht existiert (Preset-IDs
                      // sind sprachübergreifend identisch, aber wir
                      // filtern in der Dropdown nach Sprache).
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
                    placeholder="0.9"
                  />
                  <Input
                    label={t("settings.tts.advanced.maxTokens")}
                    type="number"
                    step="256"
                    min={256}
                    max={16384}
                    value={llmConfig.qwenTtsMaxNewTokens ?? ""}
                    onChange={(e) =>
                      setLlmConfig({
                        ...llmConfig,
                        qwenTtsMaxNewTokens: e.target.value,
                      })
                    }
                    placeholder="4096"
                  />
                  <Input
                    label={t("settings.tts.advanced.seed")}
                    type="number"
                    step="1"
                    value={llmConfig.qwenTtsSeedOverride ?? ""}
                    onChange={(e) =>
                      setLlmConfig({
                        ...llmConfig,
                        qwenTtsSeedOverride: e.target.value,
                      })
                    }
                    placeholder={t("settings.tts.advanced.seedAuto")}
                  />
                </div>
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
                      {v.refTextPresent && " · mit Transkript"}
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => playVoicePreview(v.id)}>
                    {t("settings.voices.preview")}
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
                  className="flex items-center gap-3 card p-3 bg-bg-elevated"
                >
                  <span className="text-base leading-none">
                    {v.gender === "female" ? "♀" : "♂"}
                  </span>
                  <div className="flex-1 min-w-0">
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
                  <Button variant="ghost" onClick={() => playDesignPreview(v.id)}>
                    {t("settings.voices.preview")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => deleteDesign(v.id, v.label)}
                  >
                    {t("common.delete")}
                  </Button>
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

        {tab === "ai" && (
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
        </div>
      </div>
    </Modal>
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
