// Stimmproben, Designs, Presets und Hörprobe der Einstellungen
import { useEffect, useRef, useState } from "react";
import {
  api,
  type CustomVoiceMeta,
  type PresetVisibility,
  type Voice,
  type VoiceDesignMeta,
} from "../../lib/api";
import { t } from "../../lib/i18n";
import { notifyVoicesChanged } from "./types";
import type { SettingsCore } from "./useSettingsCore";

export function useVoiceManager(core: SettingsCore) {
  const { toast } = core;
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
  const [customVoices, setCustomVoices] = useState<CustomVoiceMeta[]>([]);
  const [voiceUploadBusy, setVoiceUploadBusy] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<{
    label: string;
    gender: "female" | "male";
    language: "de" | "en" | "es";
    refText: string;
    file: File | null;
  }>({ label: "", gender: "female", language: "de", refText: "", file: null });
  // Alle Engine-Stimmen samt ausgeblendeter: jede Probe zeigt, mit welchen Engines sie sich anhören lässt
  const [engineVoices, setEngineVoices] = useState<Voice[]>([]);
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
    language: "de" | "en" | "es";
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
  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    api.audio
      .voices(true)
      .then((r) => setEngineVoices(r.voices))
      .catch(() => setEngineVoices([]));
  }, [customVoices, voiceDesigns]);

  // Dieselbe Probe über eine bestimmte Engine anhören (F5, Qwen, TADA …)
  function playEngineVoice(voiceId: string) {
    stopActivePreview();
    const audio = new Audio(api.audio.previewUrl(voiceId));
    activePreviewRef.current = audio;
    audio.play().catch(() => toast.show(t("settings.voices.previewFailed"), "error"));
  }

  useEffect(() => {
    return () => {
      if (designPreviewUrl) URL.revokeObjectURL(designPreviewUrl);
    };
  }, [designPreviewUrl]);




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
        language: voiceDraft.language,
        refText: voiceDraft.refText.trim() || undefined,
        file: voiceDraft.file,
      });
      const r = await api.customVoices.list();
      setCustomVoices(r.voices);
      setVoiceDraft({ label: "", gender: "female", language: voiceDraft.language, refText: "", file: null });
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

  return {
    activePreviewRef,
    customVoices,
    deleteDesign,
    deleteVoiceSample,
    designBusy,
    designDraft,
    designPreviewBlob,
    designPreviewSeed,
    designPreviewUrl,
    editBusy,
    editDesign,
    editSample,
    engineVoices,
    openDesignEdit,
    openSampleEdit,
    playDesignPreview,
    playEngineVoice,
    playVoicePreview,
    presetVisibility,
    previewDesign,
    regenerateDesignReference,
    saveDesign,
    saveDesignEdit,
    saveSampleEdit,
    setCustomVoices,
    setDesignBusy,
    setDesignDraft,
    setDesignPreviewBlob,
    setDesignPreviewSeed,
    setDesignPreviewUrl,
    setEditBusy,
    setEditDesign,
    setEditSample,
    setPresetVisibility,
    setVoiceDesigns,
    setVoiceDraft,
    setVoiceUploadBusy,
    stopActivePreview,
    toggleCustomVisibility,
    toggleDesignVisibility,
    togglePresetVisibility,
    uploadVoiceSample,
    voiceDesigns,
    voiceDraft,
    voiceUploadBusy,
  };
}

export type VoiceManager = ReturnType<typeof useVoiceManager>;
