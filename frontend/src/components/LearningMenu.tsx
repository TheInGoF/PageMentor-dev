import { useEffect, useState } from "react";
import {
  api,
  subscribeProgress,
  type Document,
  type ProgressEvent,
} from "../lib/api";
import { t, useLocale } from "../lib/i18n";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { Audiobook } from "./Audiobook";
import { PdfViewer } from "./PdfViewer";
import { PdfModal } from "./PdfModal";
import { Cards } from "./Cards";
import { ExamTrainer } from "./ExamTrainer";
import { Summaries } from "./Summaries";
import { DocumentOverview } from "./DocumentOverview";
import { cn } from "../lib/cn";

export type Tab =
  | "overview"
  | "reader"
  | "audiobook"
  | "exercises"
  | "exam"
  | "summary";

const TABS: Array<{ id: Tab; labelKey: string; requiresExtraction: boolean }> = [
  { id: "overview", labelKey: "learn.tab.overview", requiresExtraction: false },
  { id: "reader", labelKey: "learn.tab.reader", requiresExtraction: false },
  { id: "audiobook", labelKey: "learn.tab.audiobook", requiresExtraction: true },
  { id: "exercises", labelKey: "learn.tab.exercises", requiresExtraction: true },
  { id: "exam", labelKey: "learn.tab.exam", requiresExtraction: true },
  { id: "summary", labelKey: "learn.tab.summary", requiresExtraction: true },
];

interface Props {
  docId: string;
  /** Deep-link target page (tutor source pills). When set, the menu
   *  opens directly in the reader tab at that page. */
  initialPage?: number;
  onBack: () => void;
  onOpenDocument: (docId: string) => void;
  onOpenSettings: () => void;
}

export function LearningMenu({
  docId,
  initialPage,
  onBack,
  onOpenDocument: _onOpenDocument,
  onOpenSettings,
}: Props) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [tab, setTab] = useState<Tab>(initialPage ? "reader" : "overview");
  const [extractionPhase, setExtractionPhase] = useState<ProgressEvent | null>(null);
  const [extractionStartedAt, setExtractionStartedAt] = useState<number | null>(null);
  const [busyExtract, setBusyExtract] = useState(false);
  // Show a RAG source in the PDF modal: the user shouldn't lose the
  // chat answer while inspecting the cited passage.
  const [pdfSource, setPdfSource] = useState<
    { docId: string; initialPage?: number; title?: string } | null
  >(null);
  const toast = useToast();
  useLocale();

  const load = () =>
    api.documents
      .get(docId)
      .then(setDoc)
      .catch((err) =>
        toast.show(err instanceof Error ? err.message : t("common.error"), "error")
      );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // SSE subscription for pipeline phases (extraction, chapters, done/failed).
  useEffect(() => {
    const unsub = subscribeProgress(docId, (ev) => {
      if (ev.phase.startsWith("pipeline.")) {
        setExtractionPhase(ev);
        if (ev.phase === "pipeline.start") {
          setExtractionStartedAt(Date.now());
        }
        if (ev.phase === "pipeline.done" || ev.phase === "pipeline.failed") {
          setExtractionStartedAt(null);
          load();
        }
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // If the document is already extracting on page open but not yet
  // done (reload after a browser tab switch), start the timer
  // plausibly — we don't know when it actually started, but counting
  // from now is better than no timer at all.
  useEffect(() => {
    if (
      doc?.ocr_status === "running" &&
      extractionStartedAt === null
    ) {
      setExtractionStartedAt(Date.now());
    }
    if (doc?.ocr_status !== "running" && doc?.ocr_status !== "pending") {
      setExtractionStartedAt((prev) =>
        doc?.ocr_status === "done" || doc?.ocr_status === "failed" ? null : prev
      );
    }
  }, [doc?.ocr_status, extractionStartedAt]);

  const extractionDone = doc?.ocr_status === "done";
  const extractionRunning = doc?.ocr_status === "running" || doc?.ocr_status === "pending";

  async function startExtraction(opts?: { forceOcr?: boolean }) {
    setBusyExtract(true);
    try {
      await api.documents.reprocess(docId, opts);
      toast.show(t("extract.started"), "success");
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusyExtract(false);
    }
  }

  async function cancelExtraction() {
    try {
      await api.documents.cancelExtract(docId);
      toast.show(t("extract.canceled"), "success");
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-black/90 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-4">
          <Button variant="ghost" onClick={onBack} className="!px-2">
            ← {t("learn.back")}
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold truncate">{doc?.title ?? "…"}</h1>
            {doc && (
              <p className="text-xs text-neutral-500">
                {t(`type.${doc.type}`)}
                {doc.page_count > 0 && ` · ${doc.page_count} ${t("library.pagesShort")}`}
                {` · ${t(`ocr.${doc.ocr_status}`)}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              onClick={onOpenSettings}
              className="!px-2"
              title={t("settings.title")}
              aria-label={t("settings.title")}
            >
              ⚙
            </Button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {TABS.map((tb) => {
            const locked = tb.requiresExtraction && !extractionDone;
            return (
              <button
                key={tb.id}
                onClick={() => !locked && setTab(tb.id)}
                disabled={locked}
                title={locked ? t("extract.gate.tabTitle") : undefined}
                className={cn(
                  "px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap",
                  tab === tb.id
                    ? "border-accent text-neutral-100"
                    : "border-transparent text-neutral-500 hover:text-neutral-200",
                  locked && "opacity-40 cursor-not-allowed hover:text-neutral-500"
                )}
              >
                {t(tb.labelKey)}
                {locked && <span className="ml-1 text-[10px]">🔒</span>}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 flex flex-col gap-4">
        {doc && !extractionDone && tab !== "overview" && (
          <ExtractionGate
            doc={doc}
            phase={extractionPhase}
            busy={busyExtract}
            onStart={startExtraction}
            onCancel={cancelExtraction}
            running={!!extractionRunning}
          />
        )}

        {tab === "overview" && doc && (
          <DocumentOverview
            doc={doc}
            extractionPhase={extractionPhase}
            extractionRunning={!!extractionRunning}
            extractionBusy={busyExtract}
            extractionStartedAt={extractionStartedAt}
            onStartExtraction={startExtraction}
            onCancelExtraction={cancelExtraction}
            onGoTo={setTab}
          />
        )}
        {tab === "reader" && <PdfViewer docId={docId} initialPage={initialPage} />}
        {tab === "audiobook" && extractionDone &&
          (doc ? (
            <Audiobook docId={docId} documentLanguage={doc.language} />
          ) : (
            <div className="card p-6 text-sm text-neutral-500">{t("common.loading")}</div>
          ))}
        {tab === "exercises" && extractionDone && <Cards docId={docId} />}
        {tab === "exam" && extractionDone && <ExamTrainer docId={docId} />}
        {tab === "summary" && extractionDone && <Summaries docId={docId} />}
      </main>
      <PdfModal source={pdfSource} onClose={() => setPdfSource(null)} />
    </div>
  );
}

function ExtractionGate({
  doc,
  phase,
  busy,
  onStart,
  onCancel,
  running,
}: {
  doc: Document;
  phase: ProgressEvent | null;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
  running: boolean;
}) {
  const status = doc.ocr_status;
  const phaseMsg = phase?.message ?? null;

  return (
    <section className="card p-6 flex flex-col gap-3 border-accent-subtle bg-accent/5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">{t("extract.gate.title")}</h2>
          <p className="text-sm text-neutral-400 mt-1 max-w-xl">
            {status === "awaiting-extraction" && t("extract.gate.awaiting")}
            {status === "pending" && t("extract.gate.awaiting")}
            {status === "running" && t("extract.gate.running")}
            {status === "failed" && t("extract.gate.failed")}
          </p>
          {phaseMsg && running && (
            <p className="text-xs text-accent mt-2 font-mono">{phaseMsg}</p>
          )}
        </div>
        <div className="flex gap-2">
          {running ? (
            <Button variant="danger" onClick={onCancel}>
              {t("extract.cancel")}
            </Button>
          ) : (
            <Button onClick={onStart} disabled={busy}>
              {status === "failed" ? t("extract.retry") : t("extract.start")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

