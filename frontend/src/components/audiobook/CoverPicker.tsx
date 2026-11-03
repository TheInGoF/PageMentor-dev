// Cover fürs Hörbuch: Originalseite oder eine der eigenen Vorlagen, je Heft wählbar. Ohne eigene Wahl gilt der
// Standard aus Einstellungen → Hörbuch. Die Vorschau zeigt die Pille des gerade gewählten Bereichs
import { useEffect, useState } from "react";
import { api, type Document } from "../../lib/api";
import { request } from "../../lib/api/request";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";

export const COVER_STYLES = ["c", "a", "d", "original"] as const;

// Standard der App, einmal geladen und geteilt
let defaultCache: Promise<string> | null = null;
export function loadDefaultCover(force = false): Promise<string> {
  if (force || !defaultCache) defaultCache = request<{ style: string }>("/api/covers/default").then((r) => r.style).catch(() => "c");
  return defaultCache;
}

function CoverChoices({ current, defaultStyle, src, onPick }: { current: string; defaultStyle: string; src: (s: string) => string; onPick: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {COVER_STYLES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          aria-pressed={current === s}
          className={cn(
            "flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-colors",
            current === s ? "border-accent bg-accent/10" : "border-border hover:border-border-strong hover:bg-bg-hover"
          )}
        >
          <img
            src={src(s)}
            alt=""
            loading="lazy"
            className="h-32 min-w-[80px] rounded shadow-md bg-bg-elevated"
            onError={(e) => (e.currentTarget.style.visibility = "hidden")}
          />
          <span className="text-xs text-neutral-200">
            {t(`audiobook.cover.${s}`)}
            {s === defaultStyle && <span className="text-neutral-500"> · {t("audiobook.cover.default")}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function CoverPicker({ docId, kind }: { docId: string; kind: "original" | "subject" | "language" }) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [defaultStyle, setDefaultStyle] = useState("c");
  useEffect(() => {
    void api.documents.get(docId).then(setDoc).catch(() => setDoc(null));
    void loadDefaultCover().then(setDefaultStyle);
  }, [docId]);
  const current = doc?.cover_style || defaultStyle;

  async function pick(style: string | null) {
    setDoc(await api.documents.patch(docId, { cover_style: style }));
  }
  // Globaler Standard direkt von hier: gewählte Vorlage für alle Hefte ohne eigene Wahl
  async function makeDefault() {
    await request("/api/covers/default", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: current }) });
    setDefaultStyle(await loadDefaultCover(true));
    // Das Heft folgt dann dem Standard statt einer eigenen Wahl
    if (doc?.cover_style) await pick(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-neutral-400">{t("audiobook.cover")}</label>
      <CoverChoices current={current} defaultStyle={defaultStyle} src={(s) => `/api/documents/${docId}/cover?style=${s}&kind=${kind}`} onPick={(s) => void pick(s)} />
      <p className="text-xs text-neutral-500">
        {t("audiobook.cover.hint")}{" "}
        {doc?.cover_style && doc.cover_style !== defaultStyle && (
          <button type="button" className="text-accent hover:underline min-h-[32px]" onClick={() => void pick(null)}>
            {t("audiobook.cover.useDefault")}
          </button>
        )}
        {current !== defaultStyle && (
          <button type="button" className="text-accent hover:underline min-h-[32px] ml-2" onClick={() => void makeDefault()}>
            {t("audiobook.cover.makeDefault")}
          </button>
        )}
      </p>
    </div>
  );
}

// Einstellungen → Hörbuch: Vorlage für alle Hefte ohne eigene Wahl; Vorschau am neuesten Heft
export function CoverDefaultPicker() {
  const [style, setStyle] = useState("c");
  useEffect(() => {
    void loadDefaultCover().then(setStyle);
  }, []);
  async function pick(s: string) {
    setStyle(s);
    await request("/api/covers/default", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: s }) });
    void loadDefaultCover(true);
  }
  return <CoverChoices current={style} defaultStyle={style} src={(s) => `/api/covers/sample?style=${s}`} onPick={(s) => void pick(s)} />;
}
