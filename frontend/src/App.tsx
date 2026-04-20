import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { LoginScreen } from "./components/LoginScreen";
import { Library } from "./components/Library";
import { LearningMenu } from "./components/LearningMenu";
import { Dashboard } from "./components/Dashboard";
import { Modules } from "./components/Modules";
import { ModuleDetail } from "./components/ModuleDetail";
import { ToastProvider } from "./components/ui/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { t, useLocale } from "./lib/i18n";

type AuthState = "checking" | "out" | "in";
type View = "dashboard" | "library" | "modules";

interface NavState {
  view: View;
  openDocId: string | null;
  openModuleId: string | null;
}

const NAV_STORAGE_KEY = "pm_nav";

// Reload landet sonst immer auf Dashboard — wir persistieren den
// obersten Navigation-Layer in localStorage. Sub-Tabs (z. B. Hörbuch
// in LearningMenu) leben weiter in ihrem eigenen State; das kann
// später ergänzt werden wenn nötig.
function loadNav(): NavState | null {
  try {
    const raw = localStorage.getItem(NAV_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const view: View =
      p.view === "library" || p.view === "modules" ? p.view : "dashboard";
    return {
      view,
      openDocId: typeof p.openDocId === "string" ? p.openDocId : null,
      openModuleId: typeof p.openModuleId === "string" ? p.openModuleId : null,
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
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    saveNav({ view, openDocId, openModuleId });
  }, [view, openDocId, openModuleId]);

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
    if (openDocId)
      return <LearningMenu docId={openDocId} onBack={() => setOpenDocId(null)} />;
    if (openModuleId)
      return (
        <ModuleDetail
          moduleId={openModuleId}
          onBack={() => setOpenModuleId(null)}
          onOpenDocument={(id) => setOpenDocId(id)}
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
        />
      );
    if (view === "library")
      return (
        <Library
          onLogout={handleLogout}
          onOpen={(id) => setOpenDocId(id)}
          onGoDashboard={() => setView("dashboard")}
          onGoModules={() => setView("modules")}
        />
      );
    return (
      <Dashboard
        onOpenLibrary={() => setView("library")}
        onOpenModules={() => setView("modules")}
        onOpenDocument={(id) => setOpenDocId(id)}
        onLogout={handleLogout}
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
