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
import { CoverPicker } from "./audiobook/CoverPicker";
import { LearnbookBody, LearnbookProgress, LearnIntro, useLearnbook } from "./audiobook/LearnbookPanel";
import { KindFilterBar } from "./audiobook/KindFilterBar";
import { Menu, type MenuItem } from "./ui/Menu";
import { cn } from "../lib/cn";
import { request } from "../lib/api/request";
import type { ActivityItem } from "./tts/ActivityIndicator";

type Mode = "original" | "subject" | "language";
// Zuletzt gewählter Bereich je Heft (nur Bequemlichkeit, darf fehlen)
const modeKey = (docId: string) => `pm.audiobookMode.${docId}`;
function loadMode(docId: string): Mode {
  try {
    const v = localStorage.getItem(modeKey(docId));
    return v === "subject" || v === "language" ? v : "original";
  } catch {
    return "original";
  }
}

interface Props {
  docId: string;
  documentLanguage: string;
}

export function Audiobook({ docId, documentLanguage }: Props) {
  const d = useAudiobookData(docId, documentLanguage);
  const [mode, setMode] = useState<Mode>(() => loadMode(docId));
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Was für dieses Heft gerade läuft, als Hinweis auf dem passenden Knopf (auch wenn ein anderer Bereich offen ist)
  const [running, setRunning] = useState<ActivityItem[]>([]);
  useEffect(() => {
    let stop = false;
    const load = () =>
      void request<{ items: ActivityItem[] }>("/api/activity")
        .then((r) => !stop && setRunning(r.items.filter((i) => i.docId === docId)))
        .catch(() => undefined);
    load();
    const iv = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [docId]);
  const modeRun = (m: Mode) =>
    running.find((i) => (m === "original" ? i.kind === "audiobook" : i.kind === "learnbook" && i.learnKind === m));
  const pickMode = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(modeKey(docId), m);
    } catch {
      // ohne Speicher eben nicht gemerkt
    }
  };
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
  // Lernhörbuch-Zustand für Kopf und Ansicht; lädt nur, wenn eine Lern-Variante offen ist
  // Stimme hier ausdrücklich gewählt: dann übernehmen die Lernhörbücher sie, sonst behalten sie ihre bisherige
  const [voicePicked, setVoicePicked] = useState(false);
  const pickVoice = (id: string) => {
    setVoiceId(id);
    setVoicePicked(true);
  };
  const learn = useLearnbook(docId, mode === "language" ? "language" : "subject", rate, mode !== "original", voicePicked ? voiceId : "");
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
    if (first) pickVoice(first.id);
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

  const voiceName = voices.find((v) => v.id === voiceId)?.label ?? t("audiobook.voice.none");
  const rateName = rate === "+0%" ? t("rate.0") : (RATE_OPTIONS.find((r) => r.value === rate)?.label ?? rate);
  const downloadBook = () => {
    if (!state?.book) return;
    const a = document.createElement("a");
    a.href = state.book.url;
    a.download = "";
    a.click();
  };
  const bookMenu: MenuItem[] = [
    ...(state?.book && !m4bProgress ? [{ label: t("audiobook.download.m4b"), onClick: downloadBook }, { label: t("audiobook.reveal"), onClick: revealBook }] : []),
    ...((state?.audio.filter((a) => a.status === "done").length ?? 0) > 0
      ? [{ label: state?.book ? t("audiobook.m4b.rebuild") : t("audiobook.m4b.build"), onClick: rebuildM4B, disabled: m4bBusy || !!m4bProgress }]
      : []),
    ...(state?.book && !m4bProgress && absConfigured ? [{ label: absBusy ? t("audiobook.abs.uploading") : t("audiobook.abs.upload"), onClick: uploadToAbs, disabled: absBusy }] : []),
    ...((state?.audio.length ?? 0) > 0 ? [{ label: t("audiobook.clear"), onClick: clearAll, danger: true }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Gemeinsame Einstellungen für alle drei Hörbücher; Einzelheiten aufklappbar */}
      <section className="card p-4 flex flex-col gap-4">
        <button type="button" className="flex items-center gap-3 text-left w-full min-h-[44px]" onClick={() => setSettingsOpen(!settingsOpen)} aria-expanded={settingsOpen}>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">{t("audiobook.settings")}</div>
            <div className="text-xs text-neutral-500 truncate">{t("audiobook.settingsSummary", { voice: voiceName, rate: rateName })}</div>
          </div>
          <span className="text-sm text-neutral-500">{settingsOpen ? "▴" : "▾"}</span>
        </button>
        {settingsOpen && (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
              <div>
                {engines.length > 1 && (
                  <div className="mb-3">
                    <label className="text-xs font-medium text-neutral-400 block mb-2">{t("audiobook.engine")}</label>
                    <select className="input max-w-xs" value={engine} onChange={(e) => pickEngine(e.target.value)}>
                      {engines.map((e) => (
                        <option key={e} value={e}>
                          {t(`audiobook.engine.${e}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <label className="text-xs font-medium text-neutral-400 block mb-2">{t("audiobook.voice")}</label>
                {langVoices.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {langVoices.map((v) => (
                      <VoiceChip key={v.id} voice={v} active={voiceId === v.id} onSelect={() => pickVoice(v.id)} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">{t("audiobook.voice.emptyForLang", { lang: documentLanguage })}</p>
                )}
                {otherVoices.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">{t("audiobook.voice.more", { n: otherVoices.length })}</summary>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {otherVoices.map((v) => (
                        <VoiceChip key={v.id} voice={v} active={voiceId === v.id} onSelect={() => pickVoice(v.id)} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
              <div className="flex flex-col gap-3 md:min-w-[180px]">
                <div>
                  <label className="text-xs font-medium text-neutral-400 block mb-2">{t("audiobook.rate")}</label>
                  <select className="input" value={rate} onChange={(e) => setRate(e.target.value)}>
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
            <CoverPicker docId={docId} kind={mode} />
            <ComparePanel docId={docId} voices={voices} voiceId={voiceId} chapters={chapterStatus} documentLanguage={documentLanguage} />
          </div>
        )}
      </section>

      {/* Bedien-Kopf für alle drei Hörbücher: Variante wählen, erzeugen, Fortschritt, weitere Aktionen hinter ⋯ */}
      <section className="card p-4 flex flex-col gap-4 sticky top-2 z-20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="tablist">
          {(["original", "subject", "language"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => pickMode(m)}
              title={t(`audiobook.mode.${m}Hint`)}
              className={cn(
                "rounded-lg px-4 py-3 text-left flex flex-col gap-0.5 min-h-[56px] border-2 transition-colors",
                mode === m ? "border-accent bg-accent/10" : "border-border hover:border-neutral-400"
              )}
            >
              <span className={cn("text-sm font-semibold", mode === m && "text-accent")}>{t(`audiobook.mode.${m}`)}</span>
              {modeRun(m) ? (
                <span className="text-xs text-accent font-medium tabular-nums">
                  {modeRun(m)!.status === "waiting" ? t("activity.waits") : t("audiobook.mode.running")}
                  {modeRun(m)!.total ? ` · ${modeRun(m)!.done ?? 0}/${modeRun(m)!.total}` : ""}
                </span>
              ) : (
                <span className="text-xs text-neutral-500 truncate">{t(`audiobook.mode.${m}Hint`)}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <div className="flex-1 min-w-[220px]">
            {mode === "original" ? (
              m4bProgress && m4bProgress.totalMs > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">{t("audiobook.m4b.building")}</span>
                  <div className="flex-1 h-2 bg-bg-elevated rounded overflow-hidden">
                    <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.min(100, (m4bProgress.currentMs / m4bProgress.totalMs) * 100).toFixed(1)}%` }} />
                  </div>
                  <span className="text-xs text-neutral-400 font-mono tabular-nums">{((m4bProgress.currentMs / m4bProgress.totalMs) * 100).toFixed(0)}%</span>
                </div>
              ) : (
                <span className="text-xs text-neutral-500">
                  {phaseMessage || t("audiobook.status", { done: doneCount, total: includedCount })}
                </span>
              )
            ) : learn.running ? (
              <LearnbookProgress ctl={learn} />
            ) : (
              <span className="text-xs text-neutral-500">
                {learn.hasAudio
                  ? t("audiobook.learnStatus", { n: learn.info?.units.filter((u) => u.hasAudio).length ?? 0, total: learn.info?.units.length ?? 0 })
                  : t("audiobook.learnEmpty")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode === "original" ? (
              <>
                {generating && (
                  <Button variant="danger" onClick={cancelRun}>
                    {t("audiobook.cancel")}
                  </Button>
                )}
                <Button onClick={generate} disabled={busy || generating || !voiceId || (includedCount > 0 && missingCount === 0)}>
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
                {bookMenu.length > 0 && <Menu label={t("audiobook.actions")} items={bookMenu} />}
              </>
            ) : learn.running ? (
              <Button variant="danger" onClick={() => void learn.cancel()}>
                {t("audiobook.cancel")}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => void learn.start(true)}>
                  {t("learn.probe")}
                </Button>
                <Button onClick={() => void learn.start(false)}>{t(learn.hasAudio ? "learn.update" : "learn.full")}</Button>
                {learn.menu.length > 0 && <Menu label={t("audiobook.actions")} items={learn.menu} />}
              </>
            )}
          </div>
        </div>
        {mode === "original" && bookProgress && <BookProgressPanel progress={bookProgress} benchmarkMsPerChar={voices.find((v) => v.id === voiceId)?.msPerChar ?? null} />}
      </section>

      {mode === "original" && (
        <>
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

          <KindFilterBar chapters={chapterStatus} busy={kindBulkBusy} onToggle={bulkIncludeByKind} />

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
        </>
      )}

      {mode !== "original" && (
        <>
          <LearnIntro ctl={learn} kind={mode} docId={docId} rate={rate} />
          <LearnbookBody ctl={learn} kind={mode} />
        </>
      )}

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
