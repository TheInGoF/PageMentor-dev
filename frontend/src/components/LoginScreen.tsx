import { useState, type FormEvent } from "react";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { api, ApiError } from "../lib/api";
import { t, useLocale } from "../lib/i18n";

interface Props {
  onSuccess: () => void;
}

export function LoginScreen({ onSuccess }: Props) {
  useLocale();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.auth.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t("login.wrong") : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full grid place-items-center px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent/10 border border-accent-subtle mb-3">
            <span className="text-2xl">📚</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t("login.title")}</h1>
          <p className="text-xs text-neutral-500 mt-1">{t("login.subtitle")}</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            type="password"
            name="password"
            label={t("login.password")}
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-xs text-accent">{error}</p>}
          <Button type="submit" disabled={busy || !password}>
            {busy ? t("common.loading") : t("login.submit")}
          </Button>
        </form>
      </div>
    </div>
  );
}
