import { useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { t } from "../lib/i18n";
import { SearchOverlay } from "./SearchOverlay";
import { SettingsModal } from "./SettingsModal";

interface Props {
  search: string;
  onSearch: (v: string) => void;
  onLogout: () => void;
  onUpload: () => void;
  onOpenDocument: (docId: string) => void;
}

export function TopBar({ search, onSearch, onLogout, onUpload, onOpenDocument }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <>
      <header className="sticky top-0 z-30 bg-black/90 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-accent" />
            <span className="font-semibold tracking-tight">{t("app.name")}</span>
          </div>
          <div className="flex-1 max-w-xl flex items-center gap-3">
            <SearchOverlay onOpenDocument={onOpenDocument} />
            <div className="hidden md:block w-40">
              <Input
                type="search"
                value={search}
                placeholder={t("library.search.library")}
                onChange={(e) => onSearch(e.target.value)}
              />
            </div>
          </div>
          <Button variant="primary" onClick={onUpload}>
            + {t("library.upload")}
          </Button>
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
