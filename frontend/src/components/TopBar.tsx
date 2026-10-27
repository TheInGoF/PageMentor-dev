import { Button } from "./ui/Button";
import { t } from "../lib/i18n";
import { SearchOverlay } from "./SearchOverlay";
import { Logo } from "./Logo";
import { isFrameless } from "../lib/desktop";
import { cn } from "../lib/cn";
import { MAIN_VIEWS, useNav } from "../lib/nav";

interface Props {
  onUpload?: () => void;
  onOpenDocument: (docId: string) => void;
  /** Navigate to the Settings page. Required so the cog icon works on
   *  every view that mounts the TopBar. The Logs UI lives as a tab
   *  inside Settings since v1.18.098. */
  onOpenSettings: () => void;
}

/**
 * Sticky Header mit zwei Layout-Zeilen (auch auf Desktop, damit mobile
 * und desktop konsistent aussehen):
 *
 *   Zeile 1: Logo · Nav · Spacer · Upload · ⚙ · Logout
 *   Zeile 2: (nur) SearchOverlay — full width
 *
 * Vorher gab es zwei Suchleisten (globaler Full-Text-Overlay + lokaler
 * Library-Grid-Filter) und beides lag auf einer Zeile. Auf Portrait-
 * Mobil brach das horizontal aus dem Viewport, Header scrollte mit der
 * Seite mit. Jetzt: eine Suche, wrappt nie horizontal.
 */
export function TopBar({ onUpload, onOpenDocument, onOpenSettings }: Props) {
  // Mit Kontext: immer alle Bereiche; ohne (z. B. in Tests): die übergebenen Ziele
  const nav = useNav();
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
            <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
              {onUpload && (
                <Button variant="primary" onClick={onUpload}>
                  +{" "}
                  <span className="hidden sm:inline">
                    {t("library.upload")}
                  </span>
                </Button>
              )}
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
          <div className="w-full">
            <SearchOverlay onOpenDocument={onOpenDocument} />
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
