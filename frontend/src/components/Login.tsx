// Anmeldung von einem anderen Gerät im Heimnetz; am PC selbst erscheint sie nie.
// Zeigt die Oberfläche erst, wenn die Sitzung steht; ein 401 aus der API holt sie wieder hervor
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { Button } from "./ui/Button";
import { Logo } from "./Logo";

export function LoginGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "ok" | "login">("checking");
  useEffect(() => {
    api.auth
      .check()
      .then((r) => setState(r.authenticated ? "ok" : "login"))
      .catch(() => setState("ok"));
    const show = () => setState("login");
    window.addEventListener("pm:login", show);
    return () => window.removeEventListener("pm:login", show);
  }, []);
  if (state === "checking") return null;
  if (state === "ok") return <>{children}</>;
  return <LoginForm />;
}

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.auth.login(password);
      // Sauber neu starten: alle Daten werden mit der Sitzung frisch geladen
      window.location.reload();
    } catch (err) {
      setError(t(err instanceof ApiError && err.status === 429 ? "login.locked" : "login.failed"));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm flex flex-col gap-4">
        <Logo size={28} />
        <p className="text-sm text-neutral-500">{t("login.hint")}</p>
        <label className="flex flex-col gap-2 text-sm">
          {t("login.password")}
          <input className="input w-full" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={busy || !password}>
          {t("login.submit")}
        </Button>
      </form>
    </div>
  );
}
