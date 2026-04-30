import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { LoginScreen } from "./components/LoginScreen";
import { Library } from "./components/Library";
import { LearningMenu } from "./components/LearningMenu";
import { Dashboard } from "./components/Dashboard";
import { Modules } from "./components/Modules";
import { ModuleDetail } from "./components/ModuleDetail";
import { SettingsPage } from "./components/SettingsPage";
import { ToastProvider } from "./components/ui/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { t, useLocale } from "./lib/i18n";

type AuthState = "checking" | "out" | "in";
type View = "dashboard" | "library" | "modules" | "settings";

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

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [view, setView] = useState<View>(() => loadNav()?.view ?? "dashboard");
  const [openDocId, setOpenDocId] = useState<string | null>(
    () => loadNav()?.openDocId ?? null
  );
  const [openModuleId, setOpenModuleId] = useState<string | null>(
    () => loadNav()?.openModuleId ?? null
  );
  const [returnTo, setReturnTo] = useState<View | null>(
    () => loadNav()?.returnTo ?? null
  );
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    saveNav({ view, openDocId, openModuleId, returnTo });
  }, [view, openDocId, openModuleId, returnTo]);

  /** Open settings as a real page. Remembers where the user came
   *  from so the Back button takes them back to that exact view
   *  (library / modules / dashboard / a specific document). */
  function openSettings() {
    if (view !== "settings") {
      setReturnTo(view);
    }
    setView("settings");
  }
  function closeOverlayPage() {
    setView(returnTo ?? "dashboard");
    setReturnTo(null);
  }

  useEffect(() => {
    // Dev-only UI review mode: skip auth so the shell is reachable
    // without a backend running. Production builds hit the real API.
    if (import.meta.env.DEV) {
      setAuth("in");
      return;
    }
    api.auth
      .check()
      .then((r) => setAuth(r.authenticated ? "in" : "out"))
      .catch(() => setAuth("out"));
  }, []);

  if (auth === "checking") {
    return (
      <div className="min-h-full grid place-items-center text-sm text-neutral-500">
        {t("common.loading")}
      </div>
    );
  }

  const handleLogout = () => {
    try {
      localStorage.removeItem(NAV_STORAGE_KEY);
    } catch {
      // best effort
    }
    setOpenDocId(null);
    setOpenModuleId(null);
    setView("dashboard");
    setAuth("out");
  };

  function renderShell() {
    if (auth === "out") return <LoginScreen onSuccess={() => setAuth("in")} />;
    // Settings is the only overlay page — it includes the Logs tab,
    // so the Back button returns to wherever the user came from.
    if (view === "settings")
      return <SettingsPage onBack={closeOverlayPage} />;

    if (openDocId)
      return (
        <LearningMenu
          docId={openDocId}
          onBack={() => setOpenDocId(null)}
          onOpenDocument={(id) => setOpenDocId(id)}
          onLogout={handleLogout}
          onOpenSettings={openSettings}
        />
      );
    if (openModuleId)
      return (
        <ModuleDetail
          moduleId={openModuleId}
          onBack={() => setOpenModuleId(null)}
          onOpenDocument={(id) => setOpenDocId(id)}
          onLogout={handleLogout}
          onOpenSettings={openSettings}
        />
      );
    if (view === "modules")
      return (
        <Modules
          onOpenModule={(id) => setOpenModuleId(id)}
          onOpenDocument={(id) => setOpenDocId(id)}
          onGoDashboard={() => setView("dashboard")}
          onGoLibrary={() => setView("library")}
          onLogout={handleLogout}
          onOpenSettings={openSettings}
        />
      );
    if (view === "library")
      return (
        <Library
          onLogout={handleLogout}
          onOpen={(id) => setOpenDocId(id)}
          onGoDashboard={() => setView("dashboard")}
          onGoModules={() => setView("modules")}
          onOpenSettings={openSettings}
        />
      );
    return (
      <Dashboard
        onOpenLibrary={() => setView("library")}
        onOpenModules={() => setView("modules")}
        onOpenDocument={(id) => setOpenDocId(id)}
        onLogout={handleLogout}
        onOpenSettings={openSettings}
      />
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        {renderShell()}
        {auth === "in" && <ShortcutsOverlay />}
      </ToastProvider>
    </ErrorBoundary>
  );
}
