// Modul anlegen und bearbeiten: Name, Kürzel, CP, Fachsemester, Schwerpunkt, Prüfungsform, Heft-Präfixe, Farbe
import { useEffect, useState } from "react";
import { api, type Module, type ModulePrefix } from "../../lib/api";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { useToast } from "../ui/Toast";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { semesterOf } from "../../lib/modules";

// Prüfungsformen wie im Plan (Kürzel der Leistungen)
const EXAM_FORMS = ["K", "B", "L", "S", "P", "M", "A", "X"] as const;

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
  areas = [],
  onClose,
  onSaved,
}: {
  open: boolean;
  module: Module | null;
  // Vorhandene Schwerpunkte als Vorschläge
  areas?: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [studySemester, setStudySemester] = useState("");
  const [area, setArea] = useState("");
  const [examForm, setExamForm] = useState("");
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
    setStudySemester(editing && semesterOf(editing) != null ? String(semesterOf(editing)) : "");
    setArea(editing?.area ?? "");
    setExamForm(editing?.exam_form ?? "");
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
        // Altes Textfeld bleibt lesbar für ältere Ansichten
        semester: studySemester.trim() ? `Semester ${Number(studySemester)}` : editing?.semester ?? null,
        study_semester: studySemester.trim() ? Number(studySemester) : null,
        area: area.trim() || null,
        exam_form: examForm || null,
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
        <div className="grid grid-cols-[6rem_1fr_10rem] gap-3">
          <Input label={t("module.modal.studySemester")} type="number" min={1} max={20} value={studySemester} onChange={(e) => setStudySemester(e.target.value)} placeholder="1" />
          <div className="flex flex-col gap-1">
            <Input label={t("module.modal.area")} value={area} onChange={(e) => setArea(e.target.value)} placeholder={t("module.modal.areaPlaceholder")} list="pm-module-areas" />
            <datalist id="pm-module-areas">
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400">{t("module.modal.examForm")}</label>
            <select className="input" value={examForm} onChange={(e) => setExamForm(e.target.value)}>
              <option value="">–</option>
              {EXAM_FORMS.map((k) => (
                <option key={k} value={k}>{t(`plan.kind.${k}`)}</option>
              ))}
            </select>
          </div>
        </div>
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
