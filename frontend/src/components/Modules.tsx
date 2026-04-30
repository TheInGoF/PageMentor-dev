import { useCallback, useEffect, useState } from "react";
import { api, type ModuleListItem, type Module } from "../lib/api";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { useToast } from "./ui/Toast";
import { t, useLocale } from "../lib/i18n";
import { cn } from "../lib/cn";
import { TopBar } from "./TopBar";

interface Props {
  onOpenModule: (moduleId: string) => void;
  onOpenDocument: (docId: string) => void;
  onGoDashboard: () => void;
  onGoLibrary: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
}

export function Modules({
  onOpenModule,
  onOpenDocument,
  onGoDashboard,
  onGoLibrary,
  onLogout,
  onOpenSettings,
}: Props) {
  useLocale();
  const [modules, setModules] = useState<ModuleListItem[] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editModule, setEditModule] = useState<Module | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setModules(await api.modules.list());
    } catch (err) {
      if (import.meta.env.DEV) {
        setModules([]);
        return;
      }
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditModule(null);
    setEditOpen(true);
  }

  function openEdit(m: Module) {
    setEditModule(m);
    setEditOpen(true);
  }

  return (
    <div className="min-h-full flex flex-col">
      <TopBar
        onLogout={onLogout}
        onOpenDocument={onOpenDocument}
        currentView="modules"
        onGoDashboard={onGoDashboard}
        onGoLibrary={onGoLibrary}
        onGoModules={() => {}}
        onOpenSettings={onOpenSettings}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col gap-6">
        <section className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">{t("modules.title")}</h1>
            <p className="text-sm text-neutral-500 mt-1 max-w-2xl">
              {t("modules.subtitle")}
            </p>
          </div>
          <Button onClick={openCreate}>{t("modules.new")}</Button>
        </section>

        {!modules ? (
          <div className="text-sm text-neutral-500">{t("common.loading")}</div>
        ) : modules.length === 0 ? (
          <div className="card p-12 flex flex-col items-center text-center gap-4">
            <div className="text-5xl opacity-60">📚</div>
            <h2 className="text-lg font-semibold">{t("modules.empty.title")}</h2>
            <p className="text-sm text-neutral-500 max-w-md">
              {t("modules.empty.hint")}
            </p>
            <Button onClick={openCreate}>{t("modules.new")}</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {modules.map((m) => (
              <ModuleCard
                key={m.id}
                module={m}
                onOpen={() => onOpenModule(m.id)}
                onEdit={() => openEdit(m)}
              />
            ))}
          </div>
        )}
      </main>

      <ModuleEditModal
        open={editOpen}
        module={editModule}
        onClose={() => setEditOpen(false)}
        onSaved={async () => {
          setEditOpen(false);
          await load();
        }}
      />
    </div>
  );
}

function ModuleCard({
  module: m,
  onOpen,
  onEdit,
}: {
  module: ModuleListItem;
  onOpen: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className="card card-hover p-5 flex flex-col gap-3 cursor-pointer group"
      onDoubleClick={onOpen}
      style={{ borderTopColor: m.color, borderTopWidth: 3 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg grid place-items-center text-xl"
            style={{ background: m.color + "22" }}
          >
            {m.icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold truncate">{m.name}</h3>
            {m.semester && (
              <p className="text-xs text-neutral-500 mt-0.5">{m.semester}</p>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="text-xs text-neutral-500 hover:text-accent"
          aria-label={t("common.edit")}
        >
          ✎
        </button>
      </div>

      {m.description && (
        <p className="text-xs text-neutral-400 line-clamp-2">{m.description}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="tag">{t("modules.card.docs", { n: m.doc_count })}</span>
        {m.script_count > 0 && (
          <span className="tag">{t("modules.card.scripts", { n: m.script_count })}</span>
        )}
        {m.exam_doc_count > 0 && (
          <span className="tag">{t("modules.card.exams", { n: m.exam_doc_count })}</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
        <MiniStat label={t("module.stats.cards")} value={m.card_count} />
        <MiniStat
          label={t("module.stats.due")}
          value={m.card_due}
          accent={m.card_due > 0}
        />
        <MiniStat label={t("module.stats.audio")} value={m.audio_done} />
      </div>

      {m.exam_count > 0 && m.exam_avg_score != null && (
        <div className="text-xs text-neutral-500 flex items-center justify-between">
          <span>{t("modules.card.exams", { n: m.exam_count })}</span>
          <span
            className={cn(
              "font-semibold",
              m.exam_avg_score >= 80
                ? "text-emerald-400"
                : m.exam_avg_score >= 50
                ? "text-amber-400"
                : "text-accent"
            )}
          >
            {t("modules.card.examAvg", { score: Math.round(m.exam_avg_score) })}
          </span>
        </div>
      )}

      <Button variant="ghost" onClick={onOpen} className="!justify-start !px-2 text-xs">
        {t("modules.open")}
      </Button>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={cn(
          "text-lg font-semibold",
          accent && value > 0 ? "text-accent" : "text-neutral-200"
        )}
      >
        {value}
      </div>
      <div className="text-[10px] text-neutral-500 uppercase tracking-wide">
        {label}
      </div>
    </div>
  );
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

function ModuleEditModal({
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
  const [color, setColor] = useState("#ef4444");
  const [icon, setIcon] = useState("📘");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setSemester(editing?.semester ?? "");
    setDescription(editing?.description ?? "");
    setColor(editing?.color ?? "#ef4444");
    setIcon(editing?.icon ?? "📘");
    setBusy(false);
  }, [open, editing]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (editing) {
        await api.modules.patch(editing.id, {
          name: name.trim(),
          semester: semester.trim() || null,
          description: description.trim() || null,
          color,
          icon: icon.trim() || "📘",
        });
      } else {
        await api.modules.create({
          name: name.trim(),
          semester: semester.trim() || null,
          description: description.trim() || null,
          color,
          icon: icon.trim() || "📘",
        });
      }
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
