// Modul anlegen und bearbeiten: Name, Kürzel, CP, Heft-Präfixe für die Zuordnung, Farbe
import { useEffect, useState } from "react";
import { api, type Module, type ModulePrefix } from "../../lib/api";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { useToast } from "../ui/Toast";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";

// Präfixe als Liste „ABC, ABX?“; ein Fragezeichen heißt: ohne Beleg, nur Vorschlag
function formatPrefixes(rows: ModulePrefix[]): string {
  return rows.map((p) => p.prefix + (p.confirmed ? "" : "?")).join(", ");
}

function parsePrefixes(text: string): Array<{ prefix: string; confirmed: boolean }> {
  return text
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ prefix: s.replace(/\?$/, "").toUpperCase(), confirmed: !s.endsWith("?") }));
}

const COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function ModuleEditModal({
  open,
  module: editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  module: Module | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [semester, setSemester] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [icon, setIcon] = useState("📘");
  const [code, setCode] = useState("");
  const [cp, setCp] = useState("");
  const [prefixes, setPrefixes] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setSemester(editing?.semester ?? "");
    setDescription(editing?.description ?? "");
    setColor(editing?.color ?? "#3b82f6");
    setIcon(editing?.icon ?? "📘");
    setCode(editing?.code ?? "");
    setCp(editing?.cp != null ? String(editing.cp) : "");
    setPrefixes("");
    if (editing) {
      void api.study.prefixes(editing.id).then((r) => setPrefixes(formatPrefixes(r.prefixes))).catch(() => undefined);
    }
    setBusy(false);
  }, [open, editing]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        semester: semester.trim() || null,
        description: description.trim() || null,
        color,
        icon: icon.trim() || "📘",
        code: code.trim().toUpperCase() || null,
        cp: cp.trim() ? Number(cp.replace(",", ".")) : null,
      };
      const id = editing ? editing.id : (await api.modules.create(body)).id;
      if (editing) await api.modules.patch(id, body);
      await api.study.setPrefixes(id, parsePrefixes(prefixes));
      onSaved();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm(t("module.deleteConfirm", { name: editing.name }))) return;
    setBusy(true);
    try {
      await api.modules.remove(editing.id);
      onSaved();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("module.modal.title")}
      footer={
        <>
          {editing && (
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={busy}
              className="mr-auto"
            >
              {t("module.delete")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label={t("module.modal.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("module.modal.namePlaceholder")}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t("module.modal.code")} value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCDPS" className="font-mono" />
          <Input label={t("module.modal.cp")} value={cp} inputMode="decimal" onChange={(e) => setCp(e.target.value)} placeholder="6" />
        </div>
        <div className="flex flex-col gap-1">
          <Input label={t("module.modal.prefixes")} value={prefixes} onChange={(e) => setPrefixes(e.target.value)} placeholder="ABC, ABX?" className="font-mono" />
          <span className="text-xs text-neutral-500">{t("module.modal.prefixesHint")}</span>
        </div>
        <Input
          label={t("module.modal.semester")}
          value={semester}
          onChange={(e) => setSemester(e.target.value)}
          placeholder={t("module.modal.semesterPlaceholder")}
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-400">
            {t("module.modal.description")}
          </label>
          <textarea
            className="input min-h-[70px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400">
              {t("module.modal.color")}
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "w-8 h-8 rounded-md border-2 transition-transform",
                    color === c
                      ? "border-white scale-110"
                      : "border-transparent hover:scale-105"
                  )}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <Input
            label={t("module.modal.icon")}
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder={t("module.modal.iconPlaceholder")}
            className="!w-20 text-center text-lg"
          />
        </div>
      </div>
    </Modal>
  );
}
