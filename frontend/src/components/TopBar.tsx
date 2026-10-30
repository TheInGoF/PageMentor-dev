import { Button } from "./ui/Button";
import { t } from "../lib/i18n";
import { SearchOverlay } from "./SearchOverlay";
import { BatchIndicator } from "./batch/BatchIndicator";
import { Logo } from "./Logo";
import { isFrameless } from "../lib/desktop";
import { cn } from "../lib/cn";
import { MAIN_VIEWS, useNav } from "../lib/nav";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Props {
  onUpload?: () => void;
  onOpenDocument: (docId: string) => void;
  /** Navigate to the Settings page. Required so the cog icon works on
   *  every view that mounts the TopBar. The Logs UI lives as a tab
   *  inside Settings since v1.18.098. */
  onOpenSettings: (tab?: "general") => void;
}

// Kopfzeile in einer Zeile: Logo · Hauptbereiche · Suche (Strg+K) · Hochladen · Update · ⚙
export function TopBar({ onUpload, onOpenDocument, onOpenSettings }: Props) {
  // Mit Kontext: immer alle Bereiche; ohne (z. B. in Tests): die übergebenen Ziele
  const nav = useNav();
  const update = useUpdateHint();
  return (
    <>
      <header className="sticky top-0 z-30 bg-black/90 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Im rahmenlosen Fenster steht das Logo schon in der Titelleiste */}
            {!isFrameless() && <Logo size={22} />}
            {nav ? (
              <nav className="hidden sm:flex items-center gap-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                {MAIN_VIEWS.map((v) => (
                  <NavButton
                    key={v.id}
                    label={t(v.key)}
                    active={nav.view === v.id}
                    onClick={() => nav.go(v.id)}
                  />
                ))}
              </nav>
            ) : null}
            <div className="ml-auto w-40 sm:w-64 min-w-0">
              <SearchOverlay onOpenDocument={onOpenDocument} />
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <BatchIndicator />
              {onUpload && (
                <Button variant="primary" onClick={onUpload}>
                  +{" "}
                  <span className="hidden sm:inline">
                    {t("library.upload")}
                  </span>
                </Button>
              )}
              {update && (
                <Button variant="outline" className="!py-1 text-xs" onClick={() => onOpenSettings("general")}>
                  {t("update.pill", { v: update })}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => onOpenSettings()}
                className="!px-2"
                title={t("settings.title")}
                aria-label={t("settings.title")}
              >
                ⚙
              </Button>
            </div>
          </div>
        </div>
      </header>
      {/* Schmal: Hauptbereiche als Leiste unten, wie bei Apps üblich */}
      {nav && (
        <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-bg-card/95 backdrop-blur border-t border-border flex justify-around pb-[env(safe-area-inset-bottom)]">
          {MAIN_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => nav.go(v.id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px]",
                nav.view === v.id ? "text-accent" : "text-neutral-500",
              )}
            >
              <span className="text-lg leading-none" aria-hidden>
                {v.icon}
              </span>
              {t(v.key)}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

function NavButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap",
        active
          ? "bg-accent/15 text-accent border border-accent-subtle"
          : "text-neutral-300 hover:bg-bg-elevated border border-transparent",
      )}
    >
      {label}
    </button>
  );
}

// Neuere Version auf GitHub? Das Backend fragt höchstens einmal pro Stunde nach
function useUpdateHint(): string | null {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    void api.update.check().then((u) => setLatest(u.newer ? u.latest : null)).catch(() => undefined);
  }, []);
  return latest;
}
