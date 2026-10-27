// Ein Katalog-Eintrag: farbiger Balken je Kategorie, Grep-ID, Prüfvermerk, Sprung zur Quelle
import { api, type MaterialItem } from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useState } from "react";
import { useCloudReady } from "../../lib/useCloud";
import { CloudDialog } from "../cloud/CloudDialog";

// Farben nach Kategorie wie im Studium Maker; Formeln, Aufgaben und Rezepte in Akzentfarbe
const BAR: Record<string, string> = {
  definition: "border-l-blue-500",
  regel: "border-l-green-500",
  trick: "border-l-purple-500",
  warnung: "border-l-amber-500",
  zusammenhang: "border-l-sky-500",
};

export function MaterialItemCard({
  item,
  onChanged,
  onOpenDocument,
}: {
  item: MaterialItem;
  onChanged: () => void;
  onOpenDocument?: (docId: string) => void;
}) {
  const cloud = useCloudReady();
  const [review, setReview] = useState(false);

  async function toggle() {
    await api.study.setChecked(item.id, !!item.uncertain);
    onChanged();
  }

  return (
    <article className={`card p-4 border-l-4 ${BAR[item.category ?? ""] ?? "border-l-accent"} break-inside-avoid flex flex-col gap-2`}>
      <header className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold leading-snug">{item.title || item.id}</h4>
          <button
            type="button"
            className="text-[11px] font-mono text-neutral-500 hover:text-accent"
            title={t("material.copyId")}
            onClick={() => void navigator.clipboard?.writeText(item.id)}
          >
            {item.id}
            {item.category && !BAR[item.category] ? ` · ${item.category}` : ""}
          </button>
        </div>
        {item.uncertain ? (
          <Button variant="outline" className="!px-2 !py-0.5 text-xs shrink-0 print:hidden" onClick={toggle} title={t("material.checkHint")}>
            <span className="text-amber-600">⚠ {t("material.uncertain")}</span> · {t("material.markChecked")}
          </Button>
        ) : item.checked_at ? (
          <button type="button" className="text-xs text-green-600 shrink-0 print:hidden" onClick={toggle} title={t("material.uncheck")}>
            ✓ {t("material.checked")}
          </button>
        ) : null}
        {cloud && (
          <button type="button" className="text-xs text-neutral-500 hover:text-accent shrink-0 print:hidden" title={t("cloud.lektoratHint")} onClick={() => setReview(true)}>
            ☁
          </button>
        )}
      </header>
      <CloudDialog task={review ? "lektorat" : null} params={{ itemId: item.id }} onClose={() => setReview(false)} onApplied={onChanged} />
      <div className="text-sm leading-relaxed flex flex-col gap-2">{renderMarkdown(item.body_md)}</div>
      {(item.source_ref || item.source_document_id) && (
        <footer className="text-xs text-neutral-500 flex items-center gap-2 print:hidden">
          {item.source_ref && <span>{item.source_ref}</span>}
          {item.source_document_id && onOpenDocument && (
            <button type="button" className="text-accent hover:underline" onClick={() => onOpenDocument(item.source_document_id!)}>
              {t("material.openSource")} →
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
