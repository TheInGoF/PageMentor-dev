// Statuszeile mit Punkt
import { t } from "../../lib/i18n";

export function StatusRow({ label, ok, waiting }: { label: string; ok: boolean; waiting: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={
          "inline-block w-2 h-2 rounded-full " +
          (waiting ? "bg-neutral-600" : ok ? "bg-emerald-500" : "bg-accent")
        }
      />
      <span className="text-neutral-400">{label}:</span>
      <span className={ok ? "text-emerald-400" : waiting ? "text-neutral-500" : "text-accent"}>
        {waiting
          ? t("settings.status.checking")
          : ok
          ? t("settings.status.online")
          : t("settings.status.offline")}
      </span>
    </div>
  );
}
