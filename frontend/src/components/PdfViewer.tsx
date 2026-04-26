import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { api, type Chapter } from "../lib/api";
import { useToast } from "./ui/Toast";
import { t } from "../lib/i18n";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface Props {
  docId: string;
  /** When set, the viewer jumps to this page after the first PDF
   *  load. Fed by RagQA source clicks. */
  initialPage?: number;
}

const ZOOMS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];

interface ActiveSelection {
  text: string;
  page: number;
  rect: { top: number; left: number; width: number };
}

export function PdfViewer({ docId, initialPage }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [sidebar, setSidebar] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visiblePage, setVisiblePage] = useState(1);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selection, setSelection] = useState<ActiveSelection | null>(null);
  const [cardModal, setCardModal] = useState<ActiveSelection | null>(null);
  const fileUrl = `/api/documents/${docId}/pdf`;
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    api.chapters
      .list(docId)
      .then(setChapters)
      .catch(() => setChapters([]));
  }, [docId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (top) {
          const n = Number((top.target as HTMLElement).dataset.page);
          if (n) setVisiblePage(n);
        }
      },
      { root: container, threshold: [0.1, 0.5, 0.9] }
    );
    for (const el of pageRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [numPages]);

  const updateSelection = useCallback(() => {
    const sel = window.getSelection();
    const container = containerRef.current;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !container) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const startNode = range.startContainer;
    const anchor = startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : (startNode as Element);
    if (!anchor || !container.contains(anchor)) {
      setSelection(null);
      return;
    }
    // Find enclosing page wrapper via data-page.
    const pageEl = anchor.closest("[data-page]") as HTMLElement | null;
    if (!pageEl) {
      setSelection(null);
      return;
    }
    const page = Number(pageEl.dataset.page);
    const rect = range.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();

    setSelection({
      text,
      page,
      rect: {
        top: rect.bottom - contRect.top + container.scrollTop + 8,
        left: rect.left - contRect.left + container.scrollLeft,
        width: rect.width,
      },
    });
  }, []);

  useEffect(() => {
    const handler = () => updateSelection();
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [updateSelection]);

  function jumpTo(page: number) {
    const el = pageRefs.current[page - 1];
    if (el && containerRef.current) {
      containerRef.current.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
    }
  }

  // Auto-Jump auf `initialPage` sobald das PDF geladen ist und die Page-
  // Refs stehen. Triggert einmal pro (docId, initialPage)-Wechsel —
  // verhindert erneutes Springen wenn der User danach manuell scrollt.
  const jumpedToInitialRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialPage || !numPages) return;
    const key = `${docId}:${initialPage}`;
    if (jumpedToInitialRef.current === key) return;
    // Kurz warten bis Page-DOM-Elemente gemountet sind.
    const timer = setTimeout(() => {
      jumpTo(Math.max(1, Math.min(numPages, initialPage)));
      jumpedToInitialRef.current = key;
    }, 100);
    return () => clearTimeout(timer);
  }, [docId, initialPage, numPages]);

  function changeZoom(delta: number) {
    const idx = ZOOMS.findIndex((z) => z >= zoom);
    const nextIdx = Math.max(0, Math.min(ZOOMS.length - 1, (idx === -1 ? 2 : idx) + delta));
    setZoom(ZOOMS[nextIdx]);
  }

  function chapterForPage(page: number): Chapter | undefined {
    return chapters.find((ch) => page >= ch.start_page && page <= ch.end_page);
  }

  return (
    <div className="flex flex-col gap-3 h-[75vh] min-h-[500px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setSidebar(!sidebar)}
            className="!px-2 !text-xs"
            title={t("reader.thumbnailsToggle")}
            aria-label={t("reader.thumbnailsToggle")}
          >
            ☰
          </Button>
          <Button variant="outline" onClick={() => changeZoom(-1)} className="!px-2">
            −
          </Button>
          <span className="text-xs text-neutral-400 min-w-[3ch] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="outline" onClick={() => changeZoom(1)} className="!px-2">
            +
          </Button>
          <Button variant="ghost" onClick={() => setZoom(1)} className="!px-2 !text-xs">
            {t("reader.reset")}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <PageJumper current={visiblePage} total={numPages} onJump={jumpTo} />
          <a href={fileUrl} download className="btn-ghost !px-2 text-xs">
            {t("reader.downloadOriginal")}
          </a>
        </div>
      </div>

      <div className="flex-1 flex gap-3 min-h-0">
        {sidebar && numPages > 0 && (
          <aside className="card w-28 flex-shrink-0 overflow-y-auto bg-bg-elevated p-2 flex flex-col gap-2">
            <Document file={fileUrl} loading={null} error={null}>
              {Array.from({ length: numPages }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => jumpTo(i + 1)}
                  className={
                    "block w-full rounded border transition-colors p-1 " +
                    (visiblePage === i + 1
                      ? "border-accent bg-accent/10"
                      : "border-border hover:border-border-strong")
                  }
                >
                  <Page
                    pageNumber={i + 1}
                    width={96}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                  <div className="text-[10px] text-neutral-500 text-center mt-1 font-mono">
                    {i + 1}
                  </div>
                </button>
              ))}
            </Document>
          </aside>
        )}

        <div
          ref={containerRef}
          className="card flex-1 overflow-auto bg-bg-elevated p-4 flex flex-col items-center gap-4 relative"
        >
          {loadError ? (
            <div className="text-sm text-accent">{loadError}</div>
          ) : (
            <Document
              file={fileUrl}
              onLoadSuccess={({ numPages }) => {
                setNumPages(numPages);
                pageRefs.current = new Array(numPages).fill(null);
                setLoadError(null);
              }}
              onLoadError={(err) => setLoadError(err.message)}
              loading={<div className="text-sm text-neutral-500 py-8">{t("reader.loading")}</div>}
              error={<div className="text-sm text-accent py-8">{t("reader.error")}</div>}
            >
              {Array.from({ length: numPages }).map((_, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    pageRefs.current[i] = el;
                  }}
                  data-page={i + 1}
                  className="shadow-card"
                >
                  <Page
                    pageNumber={i + 1}
                    scale={zoom}
                    renderTextLayer
                    renderAnnotationLayer={false}
                  />
                </div>
              ))}
            </Document>
          )}

          {selection && (
            <button
              type="button"
              onClick={() => {
                setCardModal(selection);
                setSelection(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="absolute z-10 btn-primary !py-1 !px-3 !text-xs shadow-card"
              style={{
                top: selection.rect.top,
                left: selection.rect.left + selection.rect.width / 2,
                transform: "translateX(-50%)",
              }}
            >
              {t("reader.selectionCta")}
            </button>
          )}
        </div>
      </div>

      <CardFromSelectionModal
        open={!!cardModal}
        selection={cardModal}
        docId={docId}
        chapter={cardModal ? chapterForPage(cardModal.page) : undefined}
        onClose={() => setCardModal(null)}
      />
    </div>
  );
}

function CardFromSelectionModal({
  open,
  selection,
  docId,
  chapter,
  onClose,
}: {
  open: boolean;
  selection: ActiveSelection | null;
  docId: string;
  chapter?: Chapter;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open && selection) {
      // Sensible defaults: short selection → "What does X mean?", long → as answer
      const trimmed = selection.text.replace(/\s+/g, " ").trim();
      if (trimmed.length < 60) {
        setQuestion(t("reader.selectionQuestionDefault", { text: trimmed }));
        setAnswer("");
      } else {
        setQuestion("");
        setAnswer(trimmed);
      }
      setBusy(false);
    }
  }, [open, selection]);

  async function submit() {
    if (!selection || !question.trim()) return;
    setBusy(true);
    try {
      await api.cards.create({
        document_id: docId,
        chapter_id: chapter?.id ?? null,
        question: question.trim(),
        answer: answer.trim(),
        source_page: selection.page,
      });
      toast.show(t("reader.cardCreated"), "success");
      onClose();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("reader.selectionModalTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !question.trim()}>
            {busy ? t("common.saving") : t("cards.modal.create")}
          </Button>
        </>
      }
    >
      {selection && (
        <div className="flex flex-col gap-4">
          <div className="text-[11px] text-neutral-500">
            {chapter
              ? t("reader.selectionChapter", {
                  page: selection.page,
                  num: String(chapter.number).padStart(2, "0"),
                  title: chapter.title ?? "",
                })
              : t("reader.selectionPage", { page: selection.page })}
          </div>
          <blockquote className="card p-3 bg-bg-elevated text-sm italic border-l-2 border-accent">
            „{selection.text}"
          </blockquote>
          <Input
            label={t("cards.field.question")}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            autoFocus
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400">
              {t("cards.field.answer")}
            </label>
            <textarea
              className="input min-h-[100px] resize-y"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function PageJumper({
  current,
  total,
  onJump,
}: {
  current: number;
  total: number;
  onJump: (n: number) => void;
}) {
  const [value, setValue] = useState(String(current));
  useEffect(() => setValue(String(current)), [current]);

  if (!total) return null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = parseInt(value, 10);
        if (n >= 1 && n <= total) onJump(n);
      }}
      className="flex items-center gap-1 text-xs text-neutral-400"
    >
      <input
        type="number"
        min={1}
        max={total}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="input !w-14 !px-2 !py-1 text-center"
        aria-label={t("reader.pageOf", { total })}
      />
      <span>{t("reader.pageOf", { total })}</span>
    </form>
  );
}
