// Engine: Zustand als Liste (Probleme zuerst), Reparieren, Fortschritt; Wartung eingeklappt am Ende
import { useState } from "react";
import { api, type EngineCheck } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { useEngineStatus } from "./useEngineStatus";
import { TtsEnginesPanel } from "./TtsEnginesPanel";
import { LlmModelsPanel } from "./LlmModelsPanel";
import { Card, Expert, Notice, SettingRow } from "../settings/parts";

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
  const results = status?.results ?? [];
  // Probleme zuerst und offen; was läuft, steht eingeklappt darunter
  const ORDER = { error: 0, warn: 1, skipped: 2, ok: 3 } as const;
  const open = results.filter((r) => r.status !== "ok").sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const fine = results.filter((r) => r.status === "ok");
  return (
    <div className="flex flex-col gap-4">
      <Card title={t("engine.title")} status={results.length ? t("engine.summary", { ok: fine.length, n: results.length }) : undefined}>
        <p className="text-xs text-neutral-500">{t(`engine.auto.${status?.autoStart ?? "aus"}`)}</p>

        {task && (
          <div className="flex flex-col gap-2">
            <div className="text-sm">{task.title}</div>
            <div className="text-xs text-neutral-500 break-all">{task.message}</div>
            <div className="h-2 bg-bg-elevated rounded overflow-hidden">
              <div
                className={"h-full bg-accent transition-[width] duration-500 " + (task.fraction === undefined ? "animate-pulse w-1/3" : "")}
                style={task.fraction !== undefined ? { width: `${Math.round(task.fraction * 100)}%` } : undefined}
              />
            </div>
          </div>
        )}
        {status?.lastError && !task && <Notice kind="error">{status.lastError}</Notice>}

        {open.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {open.map((r) => (
              <CheckRow key={r.id} check={r} busy={!!task} onRepair={repair} />
            ))}
          </ul>
        )}
        {fine.length > 0 && (
          <details>
            <summary className="text-xs text-neutral-500 cursor-pointer select-none">{t("engine.fine", { n: fine.length })}</summary>
            <ul className="flex flex-col divide-y divide-border pt-2">
              {fine.map((r) => (
                <CheckRow key={r.id} check={r} busy={!!task} onRepair={repair} />
              ))}
            </ul>
          </details>
        )}

        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={selftest} disabled={testing || !!status?.checking}>
            {testing || status?.checking ? t("engine.testing") : t("engine.selftest")}
          </Button>
          {status?.checkedAt ? <span className="text-xs text-neutral-500">{t("engine.checkedAt", { time: new Date(status.checkedAt).toLocaleTimeString() })}</span> : null}
        </div>
      </Card>

      <TtsEnginesPanel />
      <LlmModelsPanel />

      {status?.windows && (
        <Expert title={t("engine.maintenance")}>
          <SettingRow label={t("engine.update")} hint={t("engine.updateHint")}>
            <Button variant="outline" className="w-full" onClick={() => repair("pull-images")} disabled={!!status?.task}>
              {t("engine.update")}
            </Button>
          </SettingRow>
          <SettingRow label={t("engine.quit")} hint={t("engine.quitHint")}>
            <Button variant="outline" className="w-full" onClick={() => confirm(t("engine.quitConfirm")) && api.engine.quitApp().catch(() => {})}>
              {t("engine.quit")}
            </Button>
          </SettingRow>
        </Expert>
      )}
    </div>
  );
}

function CheckRow({ check, busy, onRepair }: { check: EngineCheck; busy: boolean; onRepair: (id: string) => void }) {
  return (
    <li className="flex items-center gap-4 py-2">
      <span className={"w-2 h-2 rounded-full shrink-0 " + DOT[check.status]} />
      <div className="flex-1 min-w-0">
        <div className="text-sm">{check.title}</div>
        <div className="text-xs text-neutral-500">{check.message}</div>
      </div>
      {check.status !== "ok" && check.repair && (
        <Button variant="primary" disabled={busy} onClick={() => onRepair(check.repair!)}>
          {t("engine.repair")}
        </Button>
      )}
      {check.status !== "ok" && check.help && (
        <a className="btn-outline" href={check.help} target="_blank" rel="noreferrer">
          {t("engine.help")}
        </a>
      )}
    </li>
  );
}
