// Leistung anlegen oder bearbeiten; Termin aus den Prüfungsterminen oder frei
import { useEffect, useState } from "react";
import type { Assessment, AssessmentKind, ExamSlot, ModuleListItem } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { STATUSES, formatDate } from "./AssessmentRow";

const KINDS: AssessmentKind[] = ["K", "B", "L", "S", "P", "A", "M", "X", "H"];

export function AssessmentModal({
  open,
  editing,
  modules,
  slots,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  editing: Assessment | null;
  modules: ModuleListItem[];
  slots: ExamSlot[];
  onClose: () => void;
  onSave: (a: Partial<Assessment> & { title: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [f, setF] = useState<Partial<Assessment>>({});
  useEffect(() => {
    if (open) setF(editing ?? { kind: "K", status: "geplant", attempt: 1 });
  }, [open, editing]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = slots.filter((s) => s.date >= today).slice(0, 16);
  const set = (patch: Partial<Assessment>) => setF((x) => ({ ...x, ...patch }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t("plan.edit") : t("plan.add")}
      footer={
        <>
          {editing && (
            <Button variant="danger" className="mr-auto" onClick={() => confirm(t("plan.deleteConfirm", { title: editing.title })) && onDelete(editing.id)}>
              {t("common.delete")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!f.title?.trim()} onClick={() => onSave({ ...f, title: f.title!.trim() })}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-400">{t("plan.module")}</label>
          <select
            className="input"
            value={f.module_id ?? ""}
            onChange={(e) => {
              const m = modules.find((x) => x.id === e.target.value);
              set({ module_id: m?.id ?? null, title: f.title || m?.name || "" });
            }}
          >
            <option value="">–</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code ? `${m.code} · ` : ""}
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <Input label={t("plan.title")} value={f.title ?? ""} onChange={(e) => set({ title: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400">{t("plan.kindLabel")}</label>
            <select className="input" value={f.kind ?? "K"} onChange={(e) => set({ kind: e.target.value as AssessmentKind })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k} · {t(`plan.kind.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400">{t("plan.statusLabel")}</label>
            <select className="input" value={f.status ?? "geplant"} onChange={(e) => set({ status: e.target.value as Assessment["status"] })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`plan.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("plan.date")} value={f.date ?? ""} placeholder="JJJJ-MM-TT / JJJJ-MM" onChange={(e) => set({ date: e.target.value || null })} />
          <Input label={t("plan.attemptLabel")} type="number" min={1} max={3} value={f.attempt ?? 1} onChange={(e) => set({ attempt: Number(e.target.value) || 1 })} />
        </div>
        {f.kind === "K" && upcoming.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {upcoming.map((s) => (
              <button key={s.date} type="button" className={`chip ${f.date === s.date ? "chip-active" : ""}`} onClick={() => set({ date: s.date })}>
                {formatDate(s.date)}
                {s.estimate ? " · TBA" : ""}
              </button>
            ))}
          </div>
        )}
        <Input label={t("plan.note")} value={f.note ?? ""} onChange={(e) => set({ note: e.target.value || null })} />
      </div>
    </Modal>
  );
}
