import { useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { t } from "../lib/i18n";
import { SearchOverlay } from "./SearchOverlay";
import { SettingsModal } from "./SettingsModal";
import { Logo } from "./Logo";
import { cn } from "../lib/cn";

export type TopView = "dashboard" | "library" | "modules";

interface Props {
  search?: string;
  onSearch?: (v: string) => void;
  onLogout: () => void;
  onUpload?: () => void;
  onOpenDocument: (docId: string) => void;
  currentView?: TopView;
  onGoDashboard?: () => void;
  onGoLibrary?: () => void;
  onGoModules?: () => void;
}

export function TopBar({
  search,
  onSearch,
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
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-3">
          <Logo size={22} />
          {(onGoDashboard || onGoLibrary || onGoModules) && (
            <nav className="flex items-center gap-1 ml-2">
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
          <div className="flex-1 max-w-xl flex items-center gap-3">
            <SearchOverlay onOpenDocument={onOpenDocument} />
            {onSearch && (
              <div className="hidden md:block w-40">
                <Input
                  type="search"
                  value={search ?? ""}
                  placeholder={t("library.search.library")}
                  onChange={(e) => onSearch(e.target.value)}
                />
              </div>
            )}
          </div>
          {onUpload && (
            <Button variant="primary" onClick={onUpload}>
              + {t("library.upload")}
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
        "px-3 py-1.5 rounded-md text-sm transition-colors",
        active
          ? "bg-accent/15 text-accent border border-accent-subtle"
          : "text-neutral-300 hover:bg-bg-elevated border border-transparent"
      )}
    >
      {label}
    </button>
  );
}
