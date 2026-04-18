import { useEffect, useState } from "react";
import { api, type PreprocessedChapter } from "../lib/api";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { t } from "../lib/i18n";

/**
 * Side-by-side Viewer + Editor für den TTS-optimierten Kapiteltext.
 * Links: Original aus Docling (read-only). Rechts: audio_text, manuell
 * editierbar. User kann den Ollama-Output noch anfassen bevor er TTS
 * anwirft — typische Korrekturen: Eigennamen die der LLM vermanscht
 * hat, Abkürzungen die nicht ausgeschrieben wurden, eigene Pausen.
 *
 * Save → PATCH /api/audio/preprocessed/:chapterId (setzt Model-Marker
 * auf "manual-edit" damit der Status-Badge das anzeigt).
 * Reset → DELETE-Semantik via PATCH mit leerem text, der nächste
 * Preprocess-Aufruf schickt dann wieder Ollama.
 */

interface Props {
  chapterId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function AudioTextEditModal({ chapterId, onClose, onSaved }: Props) {
  const [data, setData] = useState<PreprocessedChapter | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    setLoading(true);
    api.audio
      .getPreprocessed(chapterId)
      .then((d) => {
        setData(d);
        setDraft(d.audioText ?? d.originalText);
      })
      .catch((err) => {
        toast.show(err instanceof Error ? err.message : t("common.error"), "error");
        onClose();
      })
      .finally(() => setLoading(false));
  }, [chapterId, onClose, toast]);

  async function save() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await api.audio.savePreprocessed(chapterId, draft);
      toast.show(t("audiobook.edit.saved"), "success");
      onSaved();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirm(t("audiobook.edit.resetConfirm"))) return;
    setBusy(true);
    try {
      await api.audio.savePreprocessed(chapterId, null);
      toast.show(t("audiobook.edit.reset"), "success");
      onSaved();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  const hasCleaned = !!data?.audioText;
  const modified = data != null && draft.trim() !== (data.audioText ?? data.originalText).trim();

  return (
    <Modal
      open
      onClose={onClose}
      size="3xl"
      title={t("audiobook.edit.title")}
      footer={
        <div className="flex items-center gap-2 flex-wrap">
          {hasCleaned && (
            <Button variant="outline" onClick={reset} disabled={busy}>
              {t("audiobook.edit.reset")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={busy || !modified || !draft.trim()}>
            {busy ? t("common.saving") : t("audiobook.edit.save")}
          </Button>
        </div>
      }
    >
      {loading || !data ? (
        <p className="text-sm text-neutral-500">{t("common.loading")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-neutral-500">{t("audiobook.edit.subtitle")}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 min-h-0">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">
                {t("audiobook.edit.original")}
              </label>
              <div className="bg-bg-elevated border border-border rounded-lg p-3 overflow-y-auto max-h-[60vh] min-h-[40vh] font-mono text-[12px] leading-relaxed text-neutral-300 whitespace-pre-wrap">
                {data.originalText}
              </div>
              <div className="text-[10px] text-neutral-600 text-right">
                {data.originalText.length} {t("audiobook.edit.chars")}
              </div>
            </div>
            <div className="flex flex-col gap-1 min-h-0">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide">
                {hasCleaned
                  ? data.model === "manual-edit"
                    ? t("audiobook.edit.audioManual")
                    : t("audiobook.edit.audioCleaned", { model: data.model ?? "?" })
                  : t("audiobook.edit.audioEmpty")}
              </label>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full bg-bg-card border border-border-strong rounded-lg p-3 max-h-[60vh] min-h-[40vh] font-mono text-[12px] leading-relaxed text-neutral-100 resize-none focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
                spellCheck={false}
              />
              <div className="text-[10px] text-neutral-600 text-right">
                {draft.length} {t("audiobook.edit.chars")}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
