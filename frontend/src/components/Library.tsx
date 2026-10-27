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
import { useToast } from "./ui/Toast";
import { DocumentEditModal } from "./DocumentEditModal";
import { ModuleChip, ModuleSectionHeader, EmptyState } from "./library/LibraryParts";

type ModuleFilter = "all" | "unassigned" | string;

interface Props {
  onOpen: (docId: string) => void;
  onGoDashboard?: () => void;
  onGoModules?: () => void;
  onGoTutor?: () => void;
  onOpenModule?: (id: string) => void;
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
  onOpen,
  onGoDashboard,
  onGoModules,
  onGoTutor,
  onOpenModule,
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
    const list = docs.filter((d) => {
      if (typeFilter !== "all" && d.type !== typeFilter) return false;
      if (moduleFilter === "unassigned" && d.module_id) return false;
      if (moduleFilter !== "all" && moduleFilter !== "unassigned" && d.module_id !== moduleFilter) return false;
      if (activeTags.length && !activeTags.every((tg) => d.tags.includes(tg))) return false;
      return true;
    });
    // Sortier-Reihenfolge: zuerst nach Modul-Serien-Position (1, 2, 3,
    // 10) — Hefte ohne Sequenz landen ans Ende. Dann nach Typ +
    // Erstellungsdatum als Fallback.
    return list.sort((a, b) => {
      const seqA = parseSequence(a.series_sequence);
      const seqB = parseSequence(b.series_sequence);
      if (seqA !== seqB) return seqA - seqB;
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
  }, [docs, typeFilter, moduleFilter, activeTags]);

  /** Series-Sequenz als Zahl fuer Sortierung. NULL/leer → 9999, sodass
   *  Hefte ohne Nummer ans Ende rutschen. "1.5" / "1a" → parseInt
   *  liest 1 — gut genug fuer die Sortierung. */
  function parseSequence(raw: string | null | undefined): number {
    if (!raw || !raw.trim()) return 9999;
    const n = parseInt(raw.trim(), 10);
    return Number.isFinite(n) ? n : 9999;
  }

  /** Groups the filtered documents by module for the render loop.
   *  "unassigned" (no module set) comes first, then the ACTIVE
   *  modules, and finally the COMPLETED ones in their own collapsed
   *  block at the bottom. Both groups are sorted by semester first
   *  (numeric-aware, empty semester last), then alphabetically by
   *  name. Modules without documents in the current filter selection
   *  are skipped so we don't render 20 empty headings. */
  const grouped = useMemo(() => {
    if (!filtered) return null;
    const byModule = new Map<string | null, Document[]>();
    for (const d of filtered) {
      const key = d.module_id ?? null;
      const arr = byModule.get(key);
      if (arr) arr.push(d);
      else byModule.set(key, [d]);
    }
    type Section = {
      key: string;
      module: ModuleListItem | null;
      docs: Document[];
    };
    const bySemesterThenName = (a: ModuleListItem, b: ModuleListItem) => {
      const semA = a.semester?.trim() ?? "";
      const semB = b.semester?.trim() ?? "";
      if (semA !== semB) {
        if (!semA) return 1;
        if (!semB) return -1;
        const cmp = semA.localeCompare(semB, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (cmp !== 0) return cmp;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    };
    const toSections = (mods: ModuleListItem[]): Section[] =>
      mods
        .sort(bySemesterThenName)
        .flatMap((m) => {
          const docs = byModule.get(m.id);
          return docs && docs.length > 0 ? [{ key: m.id, module: m, docs }] : [];
        });

    const unassigned = byModule.get(null);
    return {
      unassigned:
        unassigned && unassigned.length > 0
          ? ({ key: "__unassigned", module: null, docs: unassigned } as Section)
          : null,
      active: toSections(modules.filter((m) => !m.completed)),
      completed: toSections(modules.filter((m) => !!m.completed)),
    };
  }, [filtered, modules]);

  function toggleTag(tg: string) {
    setActiveTags((xs) => (xs.includes(tg) ? xs.filter((x) => x !== tg) : [...xs, tg]));
  }

  async function toggleModuleCompleted(m: ModuleListItem) {
    try {
      await api.modules.patch(m.id, { completed: m.completed ? 0 : 1 });
      setModules(await api.modules.list());
      toast.show(
        m.completed
          ? t("library.module.reopened", { name: m.name })
          : t("library.module.completedToast", { name: m.name }),
        "success"
      );
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  // Completed sections are collapsed by default; clicking the header
  // toggles them open. Keyed by module id, session-local state only.
  const [expandedCompleted, setExpandedCompleted] = useState<Set<string>>(new Set());
  function toggleExpanded(id: string) {
    setExpandedCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  return (
    <div className="min-h-full flex flex-col">
      <TopBar
        onUpload={() => setUploadOpen(true)}
        onOpenDocument={onOpen}
        currentView="library"
        onGoDashboard={onGoDashboard}
        onGoLibrary={() => {}}
        onGoModules={onGoModules}
        onGoTutor={onGoTutor}
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

        {!filtered || !grouped ? (
          <div className="text-sm text-neutral-500">{t("common.loading")}</div>
        ) : filtered.length === 0 ? (
          <EmptyState onUpload={() => setUploadOpen(true)} hasAny={(docs?.length ?? 0) > 0} />
        ) : (
          <div className="flex flex-col gap-8">
            {[
              ...(grouped.unassigned ? [grouped.unassigned] : []),
              ...grouped.active,
            ].map((section) => (
              <section key={section.key} className="flex flex-col gap-3">
                <ModuleSectionHeader
                  module={section.module}
                  count={section.docs.length}
                  onOpenModule={onOpenModule}
                  onToggleCompleted={
                    section.module
                      ? () => toggleModuleCompleted(section.module!)
                      : undefined
                  }
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {section.docs.map((d) => (
                    <DocumentCard
                      key={d.id}
                      doc={d}
                      liveEvent={liveEvents[d.id]}
                      onOpen={() => onOpen(d.id)}
                      onDelete={() => handleDelete(d)}
                      onEdit={() => setEditDoc(d)}
                      onRetried={() => void load()}
                    />
                  ))}
                </div>
              </section>
            ))}

            {grouped.completed.length > 0 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-base">✅</span>
                  <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">
                    {t("library.section.completedGroup")}
                  </h2>
                  <span className="text-xs text-neutral-600">
                    ({grouped.completed.length})
                  </span>
                  <div className="flex-1 border-b border-border" />
                </div>
                {grouped.completed.map((section) => {
                  const expanded = expandedCompleted.has(section.key);
                  return (
                    <section key={section.key} className="flex flex-col gap-3">
                      <ModuleSectionHeader
                        module={section.module}
                        count={section.docs.length}
                        onOpenModule={onOpenModule}
                        onToggleCompleted={() =>
                          toggleModuleCompleted(section.module!)
                        }
                        collapsed={!expanded}
                        onToggleCollapse={() => toggleExpanded(section.key)}
                      />
                      {expanded && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {section.docs.map((d) => (
                            <DocumentCard
                              key={d.id}
                              doc={d}
                              liveEvent={liveEvents[d.id]}
                              onOpen={() => onOpen(d.id)}
                              onDelete={() => handleDelete(d)}
                              onEdit={() => setEditDoc(d)}
                              onRetried={() => void load()}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
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
