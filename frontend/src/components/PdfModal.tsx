import { PdfViewer } from "./PdfViewer";
import { t } from "../lib/i18n";

interface Props {
  /** When null, the modal is closed. An object means: open with
   *  docId and optional initialPage to jump to. */
  source: { docId: string; initialPage?: number; title?: string } | null;
  onClose: () => void;
}

/** Full-screen modal with an embedded PdfViewer. Used by the Q&A
 *  tab to show source references on the right page of the PDF
 *  without yanking the user out of the chat context. */
export function PdfModal({ source, onClose }: Props) {
  if (!source) return null;
  return (
    <div
      // Schließt nur über ×, nicht per Hintergrund oder Escape (docs/STYLEGUIDE.md)
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col"
    >
      <div className="m-4 flex-1 flex flex-col card overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-base font-semibold truncate">
            {source.title || t("pdfModal.title")}
            {source.initialPage && (
              <span className="ml-2 text-xs text-neutral-500 font-mono">
                {t("pdfModal.page", { n: source.initialPage })}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-500 hover:text-accent transition-colors text-2xl leading-none px-2"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-hidden">
          <PdfViewer docId={source.docId} initialPage={source.initialPage} />
        </div>
      </div>
    </div>
  );
}
