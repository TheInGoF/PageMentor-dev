// Engine: Selbsttest als Kacheln, Reparieren, Fortschritt
import { useState } from "react";
import { api, type EngineCheck } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { useEngineStatus } from "./useEngineStatus";
import { TtsEnginesPanel } from "./TtsEnginesPanel";

const DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-400",
  error: "bg-red-500",
  skipped: "bg-neutral-500",
};

export function EnginePanel() {
  const { status, reload } = useEngineStatus();
  const [testing, setTesting] = useState(false);
  const toast = useToast();

  async function selftest() {
    setTesting(true);
    try {
      await api.engine.selftest();
      reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setTesting(false);
    }
  }

  async function repair(id: string) {
    try {
      await api.engine.repair(id);
      reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  const task = status?.task;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 flex-1">{t("engine.title")}</h3>
        {status?.windows && (
          <Button variant="ghost" onClick={() => repair("pull-images")} disabled={!!status?.task} title={t("engine.updateHint")}>
            {t("engine.update")}
          </Button>
        )}
        {status?.windows && (
          <Button
            variant="ghost"
            onClick={() => confirm(t("engine.quitConfirm")) && api.engine.quitApp().catch(() => {})}
          >
            {t("engine.quit")}
          </Button>
        )}
        <Button variant="outline" onClick={selftest} disabled={testing || !!status?.checking}>
          {testing || status?.checking ? t("engine.testing") : t("engine.selftest")}
        </Button>
      </div>
      <p className="text-xs text-neutral-400">{t(`engine.auto.${status?.autoStart ?? "aus"}`)}</p>

      {task && (
        <div className="card p-4 flex flex-col gap-2">
          <div className="text-sm font-medium">{task.title}</div>
          <div className="text-xs text-neutral-400 break-all">{task.message}</div>
          <div className="h-2 bg-bg-elevated rounded overflow-hidden">
            <div
              className={"h-full bg-accent transition-[width] duration-500 " + (task.fraction === undefined ? "animate-pulse w-1/3" : "")}
              style={task.fraction !== undefined ? { width: `${Math.round(task.fraction * 100)}%` } : undefined}
            />
          </div>
        </div>
      )}
      {status?.lastError && !task && <div className="text-xs text-red-400">{status.lastError}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(status?.results ?? []).map((r) => (
          <CheckTile key={r.id} check={r} busy={!!task} onRepair={repair} />
        ))}
      </div>
      {status?.checkedAt ? (
        <p className="text-[11px] text-neutral-500">
          {t("engine.checkedAt", { time: new Date(status.checkedAt).toLocaleTimeString() })}
        </p>
      ) : null}
      <TtsEnginesPanel />
    </div>
  );
}

function CheckTile({ check, busy, onRepair }: { check: EngineCheck; busy: boolean; onRepair: (id: string) => void }) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={"w-2.5 h-2.5 rounded-full shrink-0 " + DOT[check.status]} />
        <span className="text-sm font-medium flex-1">{check.title}</span>
      </div>
      <p className="text-xs text-neutral-400">{check.message}</p>
      {(check.repair || check.help) && check.status !== "ok" && (
        <div className="flex gap-2">
          {check.repair && (
            <Button variant="primary" disabled={busy} onClick={() => onRepair(check.repair!)}>
              {t("engine.repair")}
            </Button>
          )}
          {check.help && (
            <a className="btn-outline" href={check.help} target="_blank" rel="noreferrer">
              {t("engine.help")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
