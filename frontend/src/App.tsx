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

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [view, setView] = useState<View>("dashboard");
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

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
          onBack={() => setView("dashboard")}
          onLogout={handleLogout}
        />
      );
    if (view === "library")
      return (
        <Library
          onLogout={handleLogout}
          onOpen={(id) => setOpenDocId(id)}
          onBack={() => setView("dashboard")}
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
