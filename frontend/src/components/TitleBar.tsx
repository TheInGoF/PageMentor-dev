// Eigene Titelleiste für das rahmenlose Fenster, Knöpfe wie unter Windows 11
import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { cn } from "../lib/cn";
import { TITLEBAR_H, windowCommand } from "../lib/desktop";
import { Logo } from "./Logo";

// Symbole wie bei Windows 11: 10 px, 1 px Linie
const ICON = {
  min: <path d="M0 5.5h10" />,
  max: <rect x="0.5" y="0.5" width="9" height="9" rx="1" />,
  restore: (
    <>
      <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
      <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
    </>
  ),
  close: <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />,
};

function CaptionButton({ glyph, label, onClick, danger }: { glyph: keyof typeof ICON; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "h-full w-[46px] flex items-center justify-center text-neutral-200 transition-colors",
        danger ? "hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/80" : "hover:bg-neutral-500/15 active:bg-neutral-500/25"
      )}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
        {ICON[glyph]}
      </svg>
    </button>
  );
}

export function TitleBar() {
  const [max, setMax] = useState(false);

  useEffect(() => {
    window.__pmMax = setMax;
    void windowCommand("state").then(setMax);
    return () => {
      window.__pmMax = undefined;
    };
  }, []);

  // Ziehen nur auf der freien Fläche, nicht auf den Knöpfen
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    if (e.detail === 2) void windowCommand("max").then(setMax);
    else void windowCommand("drag");
  };

  return (
    <div
      className="shrink-0 flex items-stretch select-none bg-bg"
      style={{ height: TITLEBAR_H }}
      onMouseDown={onMouseDown}
    >
      <div className="flex items-center gap-2 px-3 flex-1 min-w-0">
        <Logo size={16} withLabel={false} />
        <span className="text-xs text-neutral-400 truncate">{t("app.name")}</span>
      </div>
      <CaptionButton glyph="min" label={t("window.minimize")} onClick={() => void windowCommand("min")} />
      <CaptionButton
        glyph={max ? "restore" : "max"}
        label={max ? t("window.restore") : t("window.maximize")}
        onClick={() => void windowCommand("max").then(setMax)}
      />
      <CaptionButton glyph="close" label={t("window.close")} onClick={() => void windowCommand("close")} danger />
    </div>
  );
}
