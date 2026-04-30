import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  subscribeProgress,
  type Document,
  type DocType,
  type ModuleListItem,
  type ProgressEvent,
} from "../lib/api";
import { t, useLocale } from "../lib/i18n";
import { DocumentCard } from "./DocumentCard";
import { UploadModal } from "./UploadModal";
import { TopBar } from "./TopBar";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { DocumentEditModal } from "./DocumentEditModal";

type ModuleFilter = "all" | "unassigned" | string;

interface Props {
  onLogout: () => void;
  onOpen: (docId: string) => void;
  onGoDashboard?: () => void;
  onGoModules?: () => void;
  onOpenSettings: () => void;
}

const TYPE_FILTERS: Array<"all" | DocType> = [
  "all",
  "studienheft",
  "script",
  "klausur",
  "uebung",
  "sonstiges",
];

export function Library({
  onLogout,
  onOpen,
  onGoDashboard,
  onGoModules,
  onOpenSettings,
}: Props) {
  const [docs, setDocs] = useState<Document[] | null>(null);
  const [modules, setModules] = useState<ModuleListItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | DocType>("all");
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<Document | null>(null);
  const [liveEvents, setLiveEvents] = useState<Record<string, ProgressEvent>>({});
  const streams = useRef<Map<string, () => void>>(new Map());
  const toast = useToast();
  useLocale();

  async function load() {
    try {
      setDocs(await api.documents.list());
    } catch (err) {
      if (import.meta.env.DEV) {
        // UI review mode: render empty library shell without backend.
        setDocs([]);
        return;
      }
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  useEffect(() => {
    api.modules.list().then(setModules).catch(() => setModules([]));
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(() => {
      setDocs((cur) => {
        if (cur?.some((d) => d.ocr_status === "pending" || d.ocr_status === "running")) {
          load();
        }
        return cur;
      });
    }, 2500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open SSE subscriptions only for docs that are currently processing or
  // generating audio. Close when finished.
  useEffect(() => {
    if (!docs) return;
    const active = new Set(
      docs
        .filter(
          (d) =>
            d.ocr_status === "running" ||
            d.ocr_status === "pending" ||
            ((d.audio_total ?? 0) > 0 &&
              (d.audio_done ?? 0) < (d.audio_total ?? 0))
        )
        .map((d) => d.id)
    );

    // Open new streams
    for (const id of active) {
      if (!streams.current.has(id)) {
        const close = subscribeProgress(id, (ev) => {
          setLiveEvents((prev) => ({ ...prev, [id]: ev }));
          if (
            ev.phase === "pipeline.done" ||
            ev.phase === "pipeline.failed" ||
            ev.phase === "audiobook.done" ||
            ev.phase === "audiobook.failed"
          ) {
            load();
          }
        });
        streams.current.set(id, close);
      }
    }
    // Close streams for docs no longer active
    for (const [id, close] of streams.current) {
      if (!active.has(id)) {
        close();
        streams.current.delete(id);
        setLiveEvents((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  useEffect(() => {
    return () => {
      for (const close of streams.current.values()) close();
      streams.current.clear();
    };
  }, []);

  const allTags = useMemo(() => {
    if (!docs) return [];
    const s = new Set<string>();
    for (const d of docs) for (const tg of d.tags) s.add(tg);
    return Array.from(s).sort();
  }, [docs]);

  const filtered = useMemo(() => {
    if (!docs) return null;
    return docs.filter((d) => {
      if (typeFilter !== "all" && d.type !== typeFilter) return false;
      if (moduleFilter === "unassigned" && d.module_id) return false;
      if (moduleFilter !== "all" && moduleFilter !== "unassigned" && d.module_id !== moduleFilter) return false;
      if (activeTags.length && !activeTags.every((tg) => d.tags.includes(tg))) return false;
      return true;
    });
  }, [docs, typeFilter, moduleFilter, activeTags]);

  function toggleTag(tg: string) {
    setActiveTags((xs) => (xs.includes(tg) ? xs.filter((x) => x !== tg) : [...xs, tg]));
  }

  async function handleDelete(doc: Document) {
    if (!confirm(`${t("library.deleteConfirm")}\n\n${doc.title}`)) return;
    try {
      await api.documents.remove(doc.id);
      toast.show(t("library.deleted", { title: doc.title }), "success");
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function handleLogout() {
    try {
      await api.auth.logout();
    } finally {
      onLogout();
    }
  }

  return (
    <div className="min-h-full flex flex-col">
      <TopBar
        onLogout={handleLogout}
        onUpload={() => setUploadOpen(true)}
        onOpenDocument={onOpen}
        currentView="library"
        onGoDashboard={onGoDashboard}
        onGoLibrary={() => {}}
        onGoModules={onGoModules}
        onOpenSettings={onOpenSettings}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-xs uppercase tracking-wide text-neutral-500 mr-2">
            {t("library.filter.type")}
          </span>
          {TYPE_FILTERS.map((ty) => (
            <button
              key={ty}
              onClick={() => setTypeFilter(ty)}
              className={
                "px-3 py-1 rounded-full text-xs border transition-colors " +
                (typeFilter === ty
                  ? "bg-accent/15 border-accent-subtle text-accent"
                  : "border-border text-neutral-400 hover:border-border-strong hover:text-neutral-200")
              }
            >
              {ty === "all" ? t("common.all") : t(`type.${ty}`)}
            </button>
          ))}
        </div>

        {modules.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-5">
            <span className="text-xs uppercase tracking-wide text-neutral-500 mr-2">
              {t("library.filter.module")}
            </span>
            <ModuleChip
              label={t("common.all")}
              active={moduleFilter === "all"}
              onClick={() => setModuleFilter("all")}
            />
            <ModuleChip
              label={t("library.filter.module.unassigned")}
              active={moduleFilter === "unassigned"}
              onClick={() => setModuleFilter("unassigned")}
            />
            {modules.map((m) => (
              <ModuleChip
                key={m.id}
                label={`${m.icon} ${m.name}`}
                color={m.color}
                active={moduleFilter === m.id}
                onClick={() => setModuleFilter(m.id)}
              />
            ))}
          </div>
        )}

        {allTags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-6">
            <span className="text-xs uppercase tracking-wide text-neutral-500 mr-2">
              {t("library.filter.tags")}
            </span>
            {allTags.map((tg) => {
              const active = activeTags.includes(tg);
              return (
                <button
                  key={tg}
                  onClick={() => toggleTag(tg)}
                  className={
                    "px-2.5 py-0.5 rounded-full text-xs border transition-colors " +
                    (active
                      ? "bg-accent/15 border-accent-subtle text-accent"
                      : "border-border text-neutral-400 hover:border-border-strong")
                  }
                >
                  #{tg}
                </button>
              );
            })}
          </div>
        )}

        {!filtered ? (
          <div className="text-sm text-neutral-500">{t("common.loading")}</div>
        ) : filtered.length === 0 ? (
          <EmptyState onUpload={() => setUploadOpen(true)} hasAny={(docs?.length ?? 0) > 0} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((d) => (
              <DocumentCard
                key={d.id}
                doc={d}
                liveEvent={liveEvents[d.id]}
                onOpen={() => onOpen(d.id)}
                onDelete={() => handleDelete(d)}
                onEdit={() => setEditDoc(d)}
              />
            ))}
          </div>
        )}
      </main>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          toast.show(t("library.uploadStarted"), "success");
          load();
        }}
      />

      <DocumentEditModal
        open={!!editDoc}
        doc={editDoc}
        onClose={() => setEditDoc(null)}
        onSaved={async () => {
          toast.show(t("common.done"), "success");
          await load();
        }}
      />
    </div>
  );
}

function ModuleChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-3 py-1 rounded-full text-xs border transition-colors " +
        (active
          ? "bg-accent/15 border-accent-subtle text-accent"
          : "border-border text-neutral-400 hover:border-border-strong hover:text-neutral-200")
      }
      style={active && color ? { borderColor: color, color } : undefined}
    >
      {label}
    </button>
  );
}

function EmptyState({ onUpload, hasAny }: { onUpload: () => void; hasAny: boolean }) {
  return (
    <div className="card p-12 flex flex-col items-center text-center gap-4">
      <div className="text-5xl opacity-60">📚</div>
      <div>
        <h2 className="text-lg font-semibold mb-1">
          {hasAny ? t("library.empty.nomatches.title") : t("library.empty.title")}
        </h2>
        <p className="text-sm text-neutral-500">
          {hasAny ? t("library.empty.nomatches.hint") : t("library.empty.hint")}
        </p>
      </div>
      {!hasAny && <Button onClick={onUpload}>+ {t("library.upload")}</Button>}
    </div>
  );
}
