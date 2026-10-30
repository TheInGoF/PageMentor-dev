// Aktionen des Hörbuch-Tabs: erzeugen, abbrechen, Kapitel, Intro, Auswahl
import { api } from "../../lib/api";
import { getSettings } from "../../lib/settings";
import { t } from "../../lib/i18n";
import type { AudiobookData } from "./useAudiobookData";

export function useAudiobookActions(
  docId: string,
  documentLanguage: string,
  d: AudiobookData
) {
  const {
    voiceId,
    rate,
    setState,
    setProgress,
    setChapterProgress,
    setBookProgress,
    setBusy,
    chapterStatus,
    setChapterStatus,
    setIntro,
    setIntroBusy,
    setKindBulkBusy,
    setBusyChapter,
    selectedIds,
    setSelectedIds,
    setBulkBusy,
    setM4bBusy,
    setAbsBusy,
    previewAudioRef,
    toast,
    loadChapterStatus,
  } = d;
  async function generate() {
    if (!voiceId) return;
    setBusy(true);
    try {
      await api.audio.generate(
        docId,
        voiceId,
        rate,
        getSettings().defaultOllamaModel || undefined
      );
      toast.show(t("audiobook.queued"), "success");
      setChapterProgress(new Map());
      setBookProgress(null);
      const refreshed = await api.audio.get(docId);
      setState(refreshed);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadToAbs() {
    setAbsBusy(true);
    try {
      // Kein Fenster öffnen: die App bleibt im Vordergrund (docs/STYLEGUIDE.md)
      await api.abs.upload(docId);
      toast.show(t("audiobook.abs.uploaded"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setAbsBusy(false);
    }
  }

  async function rebuildM4B() {
    setM4bBusy(true);
    try {
      await api.audio.rebuildM4B(docId);
      const refreshed = await api.audio.get(docId);
      setState(refreshed);
      toast.show(t("audiobook.m4b.built"), "success");
    } catch (err) {
      // Leere Fehlermeldung: Übersetzung als Fallback
      const msg =
        err instanceof Error && err.message.trim().length > 0
          ? err.message
          : t("common.error");
      toast.show(msg, "error");
    } finally {
      setM4bBusy(false);
    }
  }

  async function clearChapter(audioId: string) {
    if (!confirm(t("audiobook.clearChapterConfirm"))) return;
    try {
      await api.audio.clearChapter(audioId);
      // Beides neu laden, sonst bleibt die Zeile auf "fertig"
      const refreshed = await api.audio.get(docId);
      setState(refreshed);
      await loadChapterStatus();
      toast.show(t("audiobook.cleared"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function cancelRun() {
    if (!confirm(t("audiobook.cancelConfirm"))) return;
    try {
      await api.audio.cancel(docId);
      toast.show(t("audiobook.canceled"), "success");
      // UI sofort aufräumen, sonst bleibt Generieren gesperrt
      setBookProgress(null);
      setChapterProgress(new Map());
      setBusyChapter({});
      setIntroBusy(false);
      // Status frisch holen
      api.audio.get(docId).then(setState).catch(() => {});
      loadChapterStatus();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  // Aktionen pro Kapitel
  async function preprocessChapter(chapterId: string, force: boolean) {
    setBusyChapter((b) => ({ ...b, [chapterId]: "preprocess" }));
    try {
      const res = await api.audio.preprocessChapter(chapterId, {
        force,
        model: getSettings().defaultOllamaModel || undefined,
      });
      toast.show(
        res.cached
          ? t("audiobook.chapter.preprocess.cached")
          : t("audiobook.chapter.preprocess.done", { model: res.model }),
        "success"
      );
      await loadChapterStatus();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusyChapter((b) => {
        const { [chapterId]: _, ...rest } = b;
        return rest;
      });
    }
  }

  async function saveIntroText(text: string | null) {
    setIntroBusy(true);
    try {
      const res = await api.audio.setIntroText(docId, text);
      setIntro((prev) => ({ ...prev, text: res.text }));
      toast.show(t("audiobook.intro.saved"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setIntroBusy(false);
    }
  }

  async function generateIntroAudio() {
    if (!voiceId) {
      toast.show(t("audiobook.voice.emptyForLang", { lang: documentLanguage }), "error");
      return;
    }
    setIntroBusy(true);
    try {
      await api.audio.generateIntro(
        docId,
        voiceId,
        rate,
        getSettings().defaultOllamaModel || undefined
      );
      toast.show(t("audiobook.intro.queued"), "success");
      // Läuft im Hintergrund, Status per SSE
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setIntroBusy(false);
    }
  }

  async function deleteIntroAudio() {
    if (!confirm(t("audiobook.intro.deleteAudioConfirm"))) return;
    try {
      await api.audio.deleteIntroAudio(docId);
      setIntro((prev) => ({ ...prev, audioUrl: null }));
      toast.show(t("audiobook.intro.audioDeleted"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function preprocessIntro(force: boolean) {
    setIntroBusy(true);
    try {
      const res = await api.audio.preprocessIntro(docId, {
        force,
        model: getSettings().defaultOllamaModel || undefined,
      });
      toast.show(
        res.cached
          ? t("audiobook.intro.preprocessCached")
          : t("audiobook.intro.preprocessDone", { model: res.model }),
        "success"
      );
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setIntroBusy(false);
    }
  }

  async function bulkIncludeByKind(kind: string, include: boolean) {
    setKindBulkBusy(kind);
    // Optimistisch: UI vor der Antwort aktualisieren
    setChapterStatus((prev) =>
      prev.map((c) =>
        c.kind === kind ? { ...c, include_in_audio: include ? 1 : 0 } : c
      )
    );
    try {
      const res = await api.audio.setIncludeByKind(docId, kind, include);
      toast.show(
        t("audiobook.kindFilter.applied", {
          kind: t(`chapters.kind.${kind}`),
          n: res.updated,
        }),
        "success"
      );
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
      await loadChapterStatus(); // rollback
    } finally {
      setKindBulkBusy(null);
    }
  }

  function toggleSelection(chapterId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  }

  function selectAll(includedOnly: boolean) {
    setSelectedIds(
      new Set(
        chapterStatus
          .filter((c) =>
            !includedOnly
              ? true
              : c.include_in_audio == null
              ? c.kind === "content" || c.kind === "summary"
              : c.include_in_audio === 1
          )
          .map((c) => c.chapter_id)
      )
    );
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Auswahl nacheinander aufbereiten: Ollama schafft nur einen Aufruf
  async function bulkPreprocess(force: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const id of ids) {
        setBusyChapter((b) => ({ ...b, [id]: "preprocess" }));
        try {
          await api.audio.preprocessChapter(id, {
            force,
            model: getSettings().defaultOllamaModel || undefined,
          });
          ok++;
        } catch (err) {
          failed++;
          console.warn(`[bulk preprocess] chapter ${id} failed:`, err);
        } finally {
          setBusyChapter((b) => {
            const { [id]: _drop, ...rest } = b;
            return rest;
          });
        }
        // Status nach jedem Kapitel neu laden
        await loadChapterStatus();
      }
      if (failed === 0) {
        toast.show(t("audiobook.bulk.done", { n: ok }), "success");
      } else {
        toast.show(
          t("audiobook.bulk.partialDone", { ok, failed }),
          failed > ok ? "error" : "success"
        );
      }
      clearSelection();
    } finally {
      setBulkBusy(false);
    }
  }

  async function toggleInclude(chapterId: string, next: boolean) {
    // Optimistisch, bei Fehler zurück
    setChapterStatus((prev) =>
      prev.map((c) =>
        c.chapter_id === chapterId
          ? { ...c, include_in_audio: next ? 1 : 0 }
          : c
      )
    );
    try {
      await api.audio.setInclude(chapterId, next);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
      await loadChapterStatus();
    }
  }

  async function generateChapter(chapterId: string) {
    if (!voiceId) {
      toast.show(t("audiobook.voice.emptyForLang", { lang: documentLanguage }), "error");
      return;
    }
    setBusyChapter((b) => ({ ...b, [chapterId]: "generate" }));
    try {
      await api.audio.generateChapter(
        chapterId,
        voiceId,
        rate,
        getSettings().defaultOllamaModel || undefined
      );
      toast.show(t("audiobook.chapter.generate.queued"), "success");
      await loadChapterStatus();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusyChapter((b) => {
        const { [chapterId]: _, ...rest } = b;
        return rest;
      });
    }
  }

  async function clearAll() {
    if (!confirm(t("audiobook.clearConfirm"))) return;
    try {
      await api.audio.clear(docId);
      const refreshed = await api.audio.get(docId);
      setState(refreshed);
      setChapterProgress(new Map());
      setProgress(null);
      toast.show(t("audiobook.cleared"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  function playPreview() {
    if (!voiceId) return;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
    }
    const audio = new Audio(api.audio.previewUrl(voiceId));
    previewAudioRef.current = audio;
    audio.play().catch(() => toast.show(t("audiobook.previewFailed"), "error"));
  }
  // Hörbuch im Ordner Hörbücher zeigen, sonst Pfad melden
  async function revealBook() {
    try {
      const r = await api.audio.reveal(docId);
      if (!r.opened) toast.show(t("audiobook.revealPath", { path: r.path }), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  return {
    revealBook,
    generate,
    uploadToAbs,
    rebuildM4B,
    clearChapter,
    cancelRun,
    preprocessChapter,
    saveIntroText,
    generateIntroAudio,
    deleteIntroAudio,
    preprocessIntro,
    bulkIncludeByKind,
    toggleSelection,
    selectAll,
    clearSelection,
    bulkPreprocess,
    toggleInclude,
    generateChapter,
    clearAll,
    playPreview,
  };
}
