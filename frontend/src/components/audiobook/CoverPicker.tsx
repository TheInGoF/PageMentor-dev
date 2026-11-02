// Cover fürs Hörbuch: Originalseite oder eine der eigenen Vorlagen, je Heft wählbar (Standard: Farbfeld).
// Die Vorschau zeigt die Pille des gerade gewählten Bereichs (Hörbuch, Lernhörbuch, Sprachlern-Hörbuch)
import { useEffect, useState } from "react";
import { api, type Document } from "../../lib/api";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";

const STYLES = ["c", "a", "d", "original"] as const;
const DEFAULT_STYLE = "c";

export function CoverPicker({ docId, kind }: { docId: string; kind: "original" | "subject" | "language" }) {
  const [doc, setDoc] = useState<Document | null>(null);
  useEffect(() => {
    void api.documents.get(docId).then(setDoc).catch(() => setDoc(null));
  }, [docId]);
  const current = doc?.cover_style || DEFAULT_STYLE;

  async function pick(style: string) {
    setDoc(await api.documents.patch(docId, { cover_style: style }));
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-neutral-400">{t("audiobook.cover")}</label>
      <div className="flex flex-wrap gap-3">
        {STYLES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void pick(s)}
            aria-pressed={current === s}
            className={cn(
              "flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-colors",
              current === s ? "border-accent bg-accent/10" : "border-border hover:border-border-strong hover:bg-bg-hover"
            )}
          >
            <img src={`/api/documents/${docId}/cover?style=${s}&kind=${kind}`} alt="" loading="lazy" className="h-32 rounded shadow-md bg-bg-elevated" />
            <span className="text-xs text-neutral-200">
              {t(`audiobook.cover.${s}`)}
              {s === DEFAULT_STYLE && <span className="text-neutral-500"> · {t("audiobook.cover.default")}</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">{t("audiobook.cover.hint")}</p>
    </div>
  );
}
