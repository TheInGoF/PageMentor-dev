import { useEffect, useRef, useState } from "react";
import { Library } from "./components/Library";
import { LearningMenu } from "./components/LearningMenu";
import { Dashboard } from "./components/Dashboard";
import { Modules } from "./components/Modules";
import { ModuleDetail } from "./components/ModuleDetail";
import { TutorPage } from "./components/TutorPage";
import { SettingsPage, type SettingsTab } from "./components/SettingsPage";
import { EngineBanner } from "./components/engine/EngineBanner";
import { ToastProvider } from "./components/ui/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { TitleBar } from "./components/TitleBar";
import { isFrameless } from "./lib/desktop";
import { useLocale } from "./lib/i18n";

type View = "dashboard" | "library" | "modules" | "tutor" | "settings";

interface NavState {
  view: View;
  openDocId: string | null;
  openModuleId: string | null;
  /** View we'll return to from settings. Persisted so a reload
   *  on /settings keeps the back-target after the page refresh. */
  returnTo: View | null;
}

const NAV_STORAGE_KEY = "pm_nav";

// Reload would otherwise always land on Dashboard — we persist the
// top navigation layer in localStorage. Sub-tabs (e.g. Audiobook
// inside LearningMenu) keep their own state; that can be added
// later if needed.
function loadNav(): NavState | null {
  try {
    const raw = localStorage.getItem(NAV_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const validViews: View[] = [
      "dashboard",
      "library",
      "modules",
      "tutor",
      "settings",
    ];
    const view: View = validViews.includes(p.view) ? p.view : "dashboard";
    const returnTo: View | null =
      p.returnTo && validViews.includes(p.returnTo) ? p.returnTo : null;
    return {
      view,
      openDocId: typeof p.openDocId === "string" ? p.openDocId : null,
      openModuleId: typeof p.openModuleId === "string" ? p.openModuleId : null,
      returnTo,
    };
  } catch {
    return null;
  }
}

function saveNav(n: NavState): void {
  try {
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(n));
  } catch {
    // private-mode / quota exceeded — nav restore ist nice-to-have
  }
}

/** Initial nav: URL params have absolute priority (deep links from the
 *  tutor's source pills open `?openDoc=<id>` in a new tab and must
 *  land directly in the document). History.state is next (set by us
 *  on previous visits/forward navigation), localStorage is the
 *  fallback for the very first load. Default = dashboard. */
function initialNav(): NavState {
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      const openDoc = params.get("openDoc");
      if (openDoc) {
        return {
          view: "library",
          openDocId: openDoc,
          openModuleId: null,
          returnTo: null,
        };
      }
    } catch {
      // bad URL — ignore and fall through
    }
  }
  const fromHistory =
    typeof window !== "undefined" && window.history.state
      ? (window.history.state as { pmNav?: NavState }).pmNav
      : undefined;
  if (fromHistory) return fromHistory;
  return (
    loadNav() ?? {
      view: "dashboard",
      openDocId: null,
      openModuleId: null,
      returnTo: null,
    }
  );
}

/** Deep-link page target from `?openDoc=<id>&page=<n>` (tutor source
 *  pills). Read once at startup; the URL params are stripped after
 *  consumption so a reload doesn't jump back into the document. */
function initialDeepLink(): { docId: string; page: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const docId = params.get("openDoc");
    if (!docId) return null;
    const page = parseInt(params.get("page") ?? "", 10);
    return { docId, page: Number.isFinite(page) && page > 0 ? page : 0 };
  } catch {
    return null;
  }
}

export function App() {
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const [view, setView] = useState<View>(() => initialNav().view);
  const [openDocId, setOpenDocId] = useState<string | null>(
    () => initialNav().openDocId
  );
  const [openModuleId, setOpenModuleId] = useState<string | null>(
    () => initialNav().openModuleId
  );
  const [returnTo, setReturnTo] = useState<View | null>(
    () => initialNav().returnTo
  );
  const [deepLink] = useState(initialDeepLink);
  // Guard, damit popstate-Updates nicht selbst wieder pushState
  // ausloesen — sonst frisst der History-Stack sich auf.
  const skipNextHistoryPushRef = useRef(false);
  // First effect run replaces the history entry instead of pushing —
  // otherwise the first Back click after load is a no-op.
  const firstHistoryWriteRef = useRef(true);
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Bei jeder internen Nav-Aenderung in den Browser-History-Stack
  // pushen, damit der native Back-Button (oder Trackpad-Geste, oder
  // Zurueck-Taste auf der Maus) wieder zur vorherigen Ansicht in der
  // App fuehrt statt zu Google. Auch in localStorage spiegeln, damit
  // Reload weiter funktioniert.
  useEffect(() => {
    const snapshot: NavState = { view, openDocId, openModuleId, returnTo };
    saveNav(snapshot);
    if (skipNextHistoryPushRef.current) {
      // Vorherige State-Aenderung kam aus popstate — wir wollen
      // diesen Effect-Run NICHT als neuen History-Eintrag pushen.
      skipNextHistoryPushRef.current = false;
      return;
    }
    try {
      // Always write a URL without deep-link params — otherwise
      // `?openDoc=…` sticks to every history entry forever and a
      // reload jumps back into the document.
      const cleanUrl = window.location.pathname;
      if (firstHistoryWriteRef.current) {
        firstHistoryWriteRef.current = false;
        window.history.replaceState({ pmNav: snapshot }, "", cleanUrl);
      } else {
        window.history.pushState({ pmNav: snapshot }, "", cleanUrl);
      }
    } catch {
      // pushState kann in iframes / Sandboxes blockiert sein —
      // localStorage-Persistierung oben reicht in dem Fall.
    }
  }, [view, openDocId, openModuleId, returnTo]);

  // Browser-Back/Forward → State aus dem History-Eintrag
  // restaurieren statt navigieren-zu-Google.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const snap = (e.state as { pmNav?: NavState })?.pmNav;
      if (!snap) return;
      skipNextHistoryPushRef.current = true;
      setView(snap.view);
      setOpenDocId(snap.openDocId);
      setOpenModuleId(snap.openModuleId);
      setReturnTo(snap.returnTo);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Open settings as a real page. Remembers where the user came
   *  from so the Back button takes them back to that exact view
   *  (library / modules / dashboard / a specific document). */
  function openSettings(tab?: SettingsTab) {
    if (view !== "settings") {
      setReturnTo(view);
    }
    setSettingsTab(tab);
    setView("settings");
  }
  function closeOverlayPage() {
    setView(returnTo ?? "dashboard");
    setReturnTo(null);
  }

  function renderShell() {
    // Settings is the only overlay page — it includes the Logs tab,
    // so the Back button returns to wherever the user came from.
    if (view === "settings")
      return <SettingsPage onBack={closeOverlayPage} initialTab={settingsTab} />;

    if (openDocId)
      return (
        <LearningMenu
          docId={openDocId}
          initialPage={
            deepLink && deepLink.docId === openDocId && deepLink.page > 0
              ? deepLink.page
              : undefined
          }
          onBack={() => setOpenDocId(null)}
          onOpenDocument={(id) => setOpenDocId(id)}
          onOpenSettings={() => openSettings()}
        />
      );
    if (openModuleId)
      return (
        <ModuleDetail
          moduleId={openModuleId}
          onBack={() => setOpenModuleId(null)}
          onOpenDocument={(id) => setOpenDocId(id)}
          onOpenSettings={() => openSettings()}
        />
      );
    if (view === "modules")
      return (
        <Modules
          onOpenModule={(id) => setOpenModuleId(id)}
          onOpenDocument={(id) => setOpenDocId(id)}
          onGoDashboard={() => setView("dashboard")}
          onGoLibrary={() => setView("library")}
          onGoTutor={() => setView("tutor")}
          onOpenSettings={() => openSettings()}
        />
      );
    if (view === "library")
      return (
        <Library
          onOpen={(id) => setOpenDocId(id)}
          onGoDashboard={() => setView("dashboard")}
          onGoModules={() => setView("modules")}
          onGoTutor={() => setView("tutor")}
          onOpenModule={(id) => setOpenModuleId(id)}
          onOpenSettings={() => openSettings()}
        />
      );
    if (view === "tutor")
      return (
        <TutorPage
          onGoDashboard={() => setView("dashboard")}
          onGoLibrary={() => setView("library")}
          onGoModules={() => setView("modules")}
          onOpenSettings={() => openSettings()}
          onOpenDocument={(id) => setOpenDocId(id)}
          onOpenDocumentSource={(docId, page) => {
            // Open the document's PDF reader in a new tab at the
            // cited page so the chat remains visible.
            const url = `${window.location.origin}/?openDoc=${encodeURIComponent(
              docId
            )}&page=${page}`;
            window.open(url, "_blank", "noopener,noreferrer");
          }}
        />
      );
    return (
      <Dashboard
        onOpenLibrary={() => setView("library")}
        onOpenModules={() => setView("modules")}
        onOpenTutor={() => setView("tutor")}
        onOpenDocument={(id) => setOpenDocId(id)}
        onOpenSettings={() => openSettings()}
        onOpenEngine={() => openSettings("engine")}
      />
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        {/* Eigene Titelleiste im rahmenlosen Fenster, darunter scrollt die App */}
        <div className="h-full flex flex-col">
          {isFrameless() && <TitleBar />}
          <div className="flex-1 min-h-0 overflow-auto">
            <EngineBanner onOpen={() => openSettings("engine")} />
            {renderShell()}
          </div>
        </div>
        <ShortcutsOverlay />
      </ToastProvider>
    </ErrorBoundary>
  );
}
