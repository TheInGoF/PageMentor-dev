// Hörbuch-Tab: Stimme, Tempo, Erzeugung, Intro, Kapitel
import { useEffect, useMemo, useState } from "react";
import { getSettings } from "../lib/settings";
import { t } from "../lib/i18n";
import { Button } from "./ui/Button";
import { AudioTextEditModal } from "./AudioTextEditModal";
import { IntroTextEditModal } from "./IntroTextEditModal";
import { useAudiobookData } from "./audiobook/useAudiobookData";
import { useAudiobookActions } from "./audiobook/useAudiobookActions";
import { RATE_OPTIONS, compareVoices, isChapterIncluded, describePhase } from "./audiobook/helpers";
import { VoiceChip } from "./audiobook/VoiceChip";
import { ComparePanel } from "./audiobook/ComparePanel";
import { ChapterWorkbench } from "./audiobook/ChapterWorkbench";
import { BookProgressPanel } from "./audiobook/BookProgressPanel";
import { IntroEditor } from "./audiobook/IntroEditor";
import { SecondVoice } from "./audiobook/SecondVoice";
import { KindFilterBar } from "./audiobook/KindFilterBar";

interface Props {
  docId: string;
  documentLanguage: string;
}

export function Audiobook({ docId, documentLanguage }: Props) {
  const d = useAudiobookData(docId, documentLanguage);
  const {
    voices,
    voiceId,
    setVoiceId,
    rate,
    setRate,
    state,
    progress,
    chapterProgress,
    m4bProgress,
    bookProgress,
    elapsedTick,
    setElapsedTick,
    busy,
    chapterStatus,
    intro,
    introBusy,
    kindBulkBusy,
    busyChapter,
    editChapterId,
    setEditChapterId,
    editIntroOpen,
    setEditIntroOpen,
    selectedIds,
    bulkBusy,
    m4bBusy,
    absBusy,
    absConfigured,
    loadChapterStatus,
  } = d;
  const {
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
    revealBook,
  } = useAudiobookActions(docId, documentLanguage, d);

  // Zähler für die Knopf-Beschriftung, fertige Kapitel werden übersprungen
  const includedCount = useMemo(
    () => chapterStatus.filter(isChapterIncluded).length,
    [chapterStatus]
  );
  const doneCount = useMemo(
    () =>
      chapterStatus.filter(
        (c) => isChapterIncluded(c) && c.audio_status === "done"
      ).length,
    [chapterStatus]
  );
  const missingCount = Math.max(0, includedCount - doneCount);

  // Engine-Auswahl nur, wenn mehr als eine Engine Stimmen liefert
  const engines = useMemo(() => [...new Set(voices.map((v) => v.engine))], [voices]);
  const [engineSel, setEngineSel] = useState<string | null>(null);
  const engine = engineSel ?? voices.find((v) => v.id === voiceId)?.engine ?? engines[0];
  const pickEngine = (e: string) => {
    setEngineSel(e);
    const first = voices.filter((v) => v.engine === e).sort(compareVoices).find((v) => v.language === documentLanguage);
    if (first) setVoiceId(first.id);
  };
  const engineVoices = useMemo(() => voices.filter((v) => v.engine === engine), [voices, engine]);

  const langVoices = useMemo(
    () =>
      engineVoices
        .filter((v) => v.language === documentLanguage)
        .sort(compareVoices),
    [engineVoices, documentLanguage]
  );
  const otherVoices = useMemo(
    () =>
      engineVoices
        .filter((v) => v.language !== documentLanguage)
        .sort(compareVoices),
    [engineVoices, documentLanguage]
  );

  // Endzustände halten generating nicht mehr wahr
  const progressIsTerminal =
    progress?.phase === "audiobook.done" ||
    progress?.phase === "audiobook.failed" ||
    progress?.phase === "audiobook.canceled";
  // Nur ein Buch-Lauf zählt als in flight, Einzelkapitel zeigen busy in der Zeile
  const progressIsInFlight =
    !!bookProgress &&
    progress?.phase.startsWith("audiobook.") === true &&
    !progressIsTerminal;
  // Auch Einzelkapitel und Intro zählen als laufend: Abbrechen-Knopf
  const anyChapterSynthRunning = Array.from(chapterProgress.values()).some(
    (ev) =>
      ev.phase === "audiobook.chapter.start" ||
      ev.phase === "audiobook.chapter.progress" ||
      ev.phase === "audiobook.chapter.preprocess"
  );
  const anyChapterBusy = Object.values(busyChapter).some(
    (s) => s === "generate"
  );
  const generating =
    (state?.generating ?? false) ||
    progressIsInFlight ||
    anyChapterSynthRunning ||
    anyChapterBusy ||
    introBusy;
  const phaseMessage = progress ? describePhase(progress) : null;

  // Sekundentakt für Laufzeit und Restzeit
  useEffect(() => {
    if (!bookProgress) return;
    const iv = setInterval(() => setElapsedTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [bookProgress]);
  void elapsedTick;

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">{t("audiobook.title")}</h2>
            <p className="text-xs text-neutral-500 mt-1">{t("audiobook.subtitle")}</p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {state?.book && !m4bProgress && (
              <a href={state.book.url} className="btn-outline" download>
                {t("audiobook.download.m4b")}
              </a>
            )}
            {state?.book && !m4bProgress && (
              <Button variant="outline" onClick={revealBook}>
                {t("audiobook.reveal")}
              </Button>
            )}
            {(state?.audio.filter((a) => a.status === "done").length ?? 0) > 0 && (
              <Button
                variant="outline"
                onClick={rebuildM4B}
                disabled={m4bBusy || !!m4bProgress}
                title={
                  state?.book
                    ? t("audiobook.m4b.rebuildTooltip")
                    : t("audiobook.m4b.buildTooltip")
                }
              >
                {m4bBusy || m4bProgress
                  ? t("audiobook.m4b.building")
                  : state?.book
                  ? t("audiobook.m4b.rebuild")
                  : t("audiobook.m4b.build")}
              </Button>
            )}
            {state?.book && !m4bProgress && absConfigured && (
              <Button
                variant="outline"
                onClick={uploadToAbs}
                disabled={absBusy}
                title={t("audiobook.abs.uploadTooltip")}
              >
                {absBusy
                  ? t("audiobook.abs.uploading")
                  : t("audiobook.abs.upload")}
              </Button>
            )}
            {m4bProgress && m4bProgress.totalMs > 0 && (
              <div className="flex items-center gap-2 min-w-[220px]">
                <div className="flex-1 h-2 bg-bg-elevated rounded overflow-hidden">
                  <div
                    className="h-full bg-accent transition-[width] duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        (m4bProgress.currentMs / m4bProgress.totalMs) * 100
                      ).toFixed(1)}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-neutral-400 font-mono tabular-nums">
                  {(
                    (m4bProgress.currentMs / m4bProgress.totalMs) *
                    100
                  ).toFixed(0)}
                  %
                </span>
              </div>
            )}
            {(state?.audio.length ?? 0) > 0 && (
              <Button variant="danger" onClick={clearAll}>
                {t("audiobook.clear")}
              </Button>
            )}
          </div>
        </div>

        {bookProgress && (
          <BookProgressPanel
            progress={bookProgress}
            benchmarkMsPerChar={
              voices.find((v) => v.id === voiceId)?.msPerChar ?? null
            }
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
          <div>
            {engines.length > 1 && (
              <div className="mb-3">
                <label className="text-xs font-medium text-neutral-400 block mb-2">
                  {t("audiobook.engine")}
                </label>
                <select className="input max-w-xs" value={engine} onChange={(e) => pickEngine(e.target.value)}>
                  {engines.map((e) => (
                    <option key={e} value={e}>
                      {t(`audiobook.engine.${e}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label className="text-xs font-medium text-neutral-400 block mb-2">
              {t("audiobook.voice")}
            </label>
            {langVoices.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {langVoices.map((v) => (
                  <VoiceChip
                    key={v.id}
                    voice={v}
                    active={voiceId === v.id}
                    onSelect={() => setVoiceId(v.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-500">
                {t("audiobook.voice.emptyForLang", { lang: documentLanguage })}
              </p>
            )}
            {otherVoices.length > 0 && (
              <details className="mt-3">
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">
                  {t("audiobook.voice.more", { n: otherVoices.length })}
                </summary>
                <div className="flex flex-wrap gap-2 mt-2">
                  {otherVoices.map((v) => (
                    <VoiceChip
                      key={v.id}
                      voice={v}
                      active={voiceId === v.id}
                      onSelect={() => setVoiceId(v.id)}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>

          <div className="flex flex-col gap-3 md:min-w-[180px]">
            <div>
              <label className="text-xs font-medium text-neutral-400 block mb-2">
                {t("audiobook.rate")}
              </label>
              <select
                className="input"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              >
                {RATE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.value === "+0%" ? t("rate.0") : r.label}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={playPreview} disabled={!voiceId}>
              {t("audiobook.preview")}
            </Button>
          </div>
        </div>

        <SecondVoice docId={docId} voices={voices} />

        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <Button
            onClick={generate}
            disabled={
              busy ||
              generating ||
              !voiceId ||
              (includedCount > 0 && missingCount === 0)
            }
          >
            {generating
              ? t("audiobook.generating")
              : includedCount === 0
              ? t("audiobook.generate")
              : missingCount === 0
              ? t("audiobook.allDone")
              : doneCount === 0
              ? t("audiobook.generate")
              : t("audiobook.generateMissing", { n: missingCount })}
          </Button>
          {generating && (
            <Button variant="danger" onClick={cancelRun}>
              {t("audiobook.cancel")}
            </Button>
          )}
          {phaseMessage && (
            <span className="text-xs text-neutral-400 truncate">{phaseMessage}</span>
          )}
        </div>
      </section>

      <ComparePanel
        docId={docId}
        voices={voices}
        voiceId={voiceId}
        chapters={chapterStatus}
        documentLanguage={documentLanguage}
      />

      <IntroEditor
        intro={intro}
        voice={voices.find((v) => v.id === voiceId) ?? null}
        modelName={getSettings().defaultOllamaModel}
        busy={introBusy}
        canGenerate={!!voiceId}
        onSave={saveIntroText}
        onGenerate={generateIntroAudio}
        onDeleteAudio={deleteIntroAudio}
        onPreprocess={preprocessIntro}
        onEditTts={() => setEditIntroOpen(true)}
      />

      <KindFilterBar
        chapters={chapterStatus}
        busy={kindBulkBusy}
        onToggle={bulkIncludeByKind}
      />

      <ChapterWorkbench
        chapters={chapterStatus}
        chapterProgress={chapterProgress}
        busyChapter={busyChapter}
        bulkBusy={bulkBusy}
        selectedIds={selectedIds}
        disabled={!voiceId}
        onPreprocess={preprocessChapter}
        onEdit={(id) => setEditChapterId(id)}
        onGenerate={generateChapter}
        onClearChapter={clearChapter}
        onToggleInclude={toggleInclude}
        onToggleSelect={toggleSelection}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBulkPreprocess={bulkPreprocess}
      />

      {editChapterId && (
        <AudioTextEditModal
          chapterId={editChapterId}
          onClose={() => setEditChapterId(null)}
          onSaved={() => {
            setEditChapterId(null);
            loadChapterStatus();
          }}
        />
      )}

      {editIntroOpen && (
        <IntroTextEditModal
          docId={docId}
          onClose={() => setEditIntroOpen(false)}
          onSaved={() => setEditIntroOpen(false)}
        />
      )}

    </div>
  );
}
