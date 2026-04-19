import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { getSettings, setSettings, type Settings } from "../lib/settings";
import { api, type CustomVoiceMeta, type OllamaStatus, type Voice } from "../lib/api";
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
}

interface Props {
  open: boolean;
  onClose: () => void;
}

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
  const [llmBusy, setLlmBusy] = useState(false);
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
    api.audio.voices().then((r) => setVoices(r.voices)).catch(() => setVoices([]));
    api.search.status().then((r) => setMeiliEnabled(r.enabled)).catch(() => setMeiliEnabled(false));
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
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
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

          <div className="border-t border-border pt-3 mt-1 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-neutral-300">
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
          </div>

          <Button onClick={saveLlmConfig} disabled={llmBusy}>
            {llmBusy ? t("common.saving") : t("settings.llm.save")}
          </Button>
        </section>

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
        </section>
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
