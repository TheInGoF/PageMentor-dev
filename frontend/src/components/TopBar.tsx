import { useState } from "react";
import { Button } from "./ui/Button";
import { t } from "../lib/i18n";
import { SearchOverlay } from "./SearchOverlay";
import { SettingsModal } from "./SettingsModal";
import { Logo } from "./Logo";
import { cn } from "../lib/cn";

export type TopView = "dashboard" | "library" | "modules";

interface Props {
  onLogout: () => void;
  onUpload?: () => void;
  onOpenDocument: (docId: string) => void;
  currentView?: TopView;
  onGoDashboard?: () => void;
  onGoLibrary?: () => void;
  onGoModules?: () => void;
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
export function TopBar({
  onLogout,
  onUpload,
  onOpenDocument,
  currentView,
  onGoDashboard,
  onGoLibrary,
  onGoModules,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <>
      <header className="sticky top-0 z-30 bg-black/90 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Logo size={22} />
            {(onGoDashboard || onGoLibrary || onGoModules) && (
              <nav className="flex items-center gap-1 min-w-0 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                {onGoDashboard && (
                  <NavButton
                    label={t("nav.home")}
                    active={currentView === "dashboard"}
                    onClick={onGoDashboard}
                  />
                )}
                {onGoLibrary && (
                  <NavButton
                    label={t("nav.library")}
                    active={currentView === "library"}
                    onClick={onGoLibrary}
                  />
                )}
                {onGoModules && (
                  <NavButton
                    label={t("nav.modules")}
                    active={currentView === "modules"}
                    onClick={onGoModules}
                  />
                )}
              </nav>
            )}
            <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
              {onUpload && (
                <Button variant="primary" onClick={onUpload}>
                  + <span className="hidden sm:inline">{t("library.upload")}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => setSettingsOpen(true)}
                className="!px-2"
                title={t("settings.title")}
                aria-label={t("settings.title")}
              >
                ⚙
              </Button>
              <Button variant="ghost" onClick={onLogout}>
                {t("library.logout")}
              </Button>
            </div>
          </div>
          <div className="w-full">
            <SearchOverlay onOpenDocument={onOpenDocument} />
          </div>
        </div>
      </header>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
          : "text-neutral-300 hover:bg-bg-elevated border border-transparent"
      )}
    >
      {label}
    </button>
  );
}
