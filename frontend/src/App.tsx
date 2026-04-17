import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { LoginScreen } from "./components/LoginScreen";
import { Library } from "./components/Library";
import { LearningMenu } from "./components/LearningMenu";
import { Dashboard } from "./components/Dashboard";
import { ToastProvider } from "./components/ui/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { t, useLocale } from "./lib/i18n";

type AuthState = "checking" | "out" | "in";
type View = "dashboard" | "library";

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [view, setView] = useState<View>("dashboard");
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
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
    setView("dashboard");
    setAuth("out");
  };

  return (
    <ErrorBoundary>
      <ToastProvider>
        {auth === "out" ? (
          <LoginScreen onSuccess={() => setAuth("in")} />
        ) : openDocId ? (
          <LearningMenu docId={openDocId} onBack={() => setOpenDocId(null)} />
        ) : view === "dashboard" ? (
          <Dashboard
            onOpenLibrary={() => setView("library")}
            onOpenDocument={(id) => setOpenDocId(id)}
            onLogout={handleLogout}
          />
        ) : (
          <Library
            onLogout={handleLogout}
            onOpen={(id) => setOpenDocId(id)}
          />
        )}
        {auth === "in" && <ShortcutsOverlay />}
      </ToastProvider>
    </ErrorBoundary>
  );
}
