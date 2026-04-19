import { useEffect } from "react";
import { PdfViewer } from "./PdfViewer";
import { t } from "../lib/i18n";

interface Props {
  /** Wenn null, ist der Modal zu. Ein Objekt heißt: öffnen mit docId +
   *  optional initialPage zum Hinspringen. */
  source: { docId: string; initialPage?: number; title?: string } | null;
  onClose: () => void;
}

/** Voll-flächiges Modal mit eingebettetem PdfViewer. Genutzt vom
 *  Frage-Tab, um Quellen-Referenzen auf der richtigen Seite des PDFs
 *  anzuzeigen, ohne den Nutzer vom Chat-Kontext wegzureißen. */
export function PdfModal({ source, onClose }: Props) {
  useEffect(() => {
    if (!source) return;
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [source, onClose]);

  if (!source) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col"
      onClick={onClose}
    >
      <div
        className="m-4 flex-1 flex flex-col card overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
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
