// Cloud-Hilfe: Schalter, wohin gesendet würde, Protokoll, Fehlversuche der lokalen KI zur Diagnose
import { useEffect, useState } from "react";
import { api, type CloudStatus } from "../../lib/api";
import { refreshCloud } from "../../lib/useCloud";
import { t } from "../../lib/i18n";
import { CloudDialog } from "../cloud/CloudDialog";

type Failure = Awaited<ReturnType<typeof api.cloud.failures>>["failures"][number];

export function CloudSection() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [diagnose, setDiagnose] = useState<number | null>(null);

  const load = async () => {
    setStatus(await api.cloud.status());
    setFailures((await api.cloud.failures()).failures);
  };
  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  if (!status) return null;
  const noKey = status.targets.length === 0;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs uppercase tracking-wide text-neutral-500">{t("cloud.sectionTitle")}</h3>
      <div className="card p-5 flex flex-col gap-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={status.enabled}
            disabled={noKey}
            onChange={async (e) => {
              await api.cloud.setEnabled(e.target.checked);
              refreshCloud();
              await load();
            }}
          />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("cloud.enable")}</span>
            <span className="text-xs text-neutral-500">{noKey ? t("cloud.noKey") : t("cloud.enableHint", { targets: status.targets.map((x) => `${x.label} (${x.model})`).join(", ") })}</span>
          </span>
        </label>

        {failures.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-xs text-neutral-500">{t("cloud.failures")}</div>
            <ul className="text-sm divide-y divide-border">
              {failures.slice(0, 10).map((f) => (
                <li key={f.id} className="py-1.5 flex items-center gap-2">
                  <span className="font-mono text-xs">{f.kind}</span>
                  <span className="flex-1 min-w-0 truncate text-xs text-neutral-500">{f.error}</span>
                  <span className="text-xs text-neutral-500">{f.created_at}</span>
                  {status.enabled && (
                    <button type="button" className="text-xs text-accent" onClick={() => setDiagnose(f.id)}>
                      ☁ {t("cloud.diagnose")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {status.log.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-neutral-500">{t("cloud.log", { n: status.log.length })}</summary>
            <ul className="mt-1 text-xs text-neutral-500">
              {status.log.map((l, i) => (
                <li key={i}>
                  {l.sent_at} · {l.task} · {l.provider} ({l.model}) · {l.chars.toLocaleString()} {t("cloud.chars")} {l.ok ? "" : "· ⚠"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <CloudDialog task={diagnose != null ? "diagnose" : null} params={{ failureId: diagnose }} onClose={() => setDiagnose(null)} onDone={() => void load()} />
    </section>
  );
}
