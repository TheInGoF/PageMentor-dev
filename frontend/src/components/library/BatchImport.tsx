// Stapel-Import: ganzen Ordner (z. B. alle Studienhefte oder Literatur) in die Warteschlange
import { useEffect, useState } from "react";
import { api, type BatchStatus, type ModuleListItem } from "../../lib/api";
import { isFrameless } from "../../lib/desktop";
import { t } from "../../lib/i18n";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

const duration = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);

export function BatchImport({ open, onClose, modules }: { open: boolean; onClose: () => void; modules: ModuleListItem[] }) {
  const [folder, setFolder] = useState("");
  const [mdFolder, setMdFolder] = useState("");
  const [docType, setDocType] = useState("studienheft");
  const [moduleId, setModuleId] = useState("");
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const load = () => void api.knowledge.batch().then(setStatus).catch(() => undefined);
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [open]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setStatus(await api.knowledge.batch());
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  };

  async function start() {
    await act(async () => {
      const r = await api.knowledge.enqueue({ folder, docType, moduleId: moduleId || null, mdFolder: mdFolder || null });
      toast.show(t("batch.queued", { added: r.added, skipped: r.skipped, md: r.withMarkdown }), "success");
    });
  }

  const total = status ? status.waiting + status.running + status.done + status.failed : 0;
  const pct = total ? Math.round(((status!.done + status!.failed) / total) * 100) : 0;

  return (
    <Modal open={open} onClose={onClose} title={t("batch.title")} footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-500">{t("batch.hint")}</p>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder={t("batch.folder")} value={folder} onChange={(e) => setFolder(e.target.value)} />
          {isFrameless() && (
            <Button variant="outline" onClick={async () => setFolder((await api.study.pickFolder()).folder ?? folder)}>
              …
            </Button>
          )}
        </div>
        <input className="input" placeholder={t("batch.mdFolder")} value={mdFolder} onChange={(e) => setMdFolder(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
            {["studienheft", "literatur", "script", "klausur", "uebung", "sonstiges"].map((ty) => (
              <option key={ty} value={ty}>
                {t(`type.${ty}`)}
              </option>
            ))}
          </select>
          <select className="input" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">{t("batch.autoModule")}</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code ? `${m.code} · ` : ""}
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={start} disabled={!folder.trim()}>
          {t("batch.start")}
        </Button>

        {status && total > 0 && (
          <div className="card p-4 flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span>{t("batch.progress", { done: status.done, total, failed: status.failed })}</span>
              {status.etaSeconds != null && status.waiting > 0 && <span className="text-neutral-500">{t("batch.eta", { time: duration(status.etaSeconds) })}</span>}
            </div>
            <div className="h-2 rounded-full bg-bg-elevated overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            {status.current && <div className="text-xs text-neutral-500 truncate">{t("batch.current", { name: status.current })}</div>}
            {status.paused && <div className="text-xs text-amber-600">{t("batch.paused")}</div>}
            <div className="flex flex-wrap gap-2 items-center">
              <Button variant="outline" className="!py-1 text-xs" onClick={() => act(() => api.knowledge.flags({ paused: !status.paused }))}>
                {status.paused ? t("batch.resume") : t("batch.pause")}
              </Button>
              <label className="text-xs flex items-center gap-1.5">
                <input type="checkbox" checked={status.nightOnly} onChange={(e) => act(() => api.knowledge.flags({ nightOnly: e.target.checked }))} />
                {t("batch.nightOnly")}
              </label>
              {status.failed > 0 && (
                <Button variant="ghost" className="!py-1 text-xs" onClick={() => act(() => api.knowledge.retry())}>
                  {t("batch.retry")}
                </Button>
              )}
              {status.done > 0 && (
                <Button variant="ghost" className="!py-1 text-xs ml-auto" onClick={() => act(() => api.knowledge.clear())}>
                  {t("batch.clear")}
                </Button>
              )}
            </div>
            {status.failures.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-600">{t("batch.failures", { n: status.failures.length })}</summary>
                <ul className="mt-1 text-neutral-500 max-h-40 overflow-y-auto">
                  {status.failures.map((f) => (
                    <li key={f.id} className="truncate" title={f.error ?? ""}>
                      {f.path.split(/[\\/]/).pop()}: {f.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
