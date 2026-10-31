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
import { getSettings } from "../lib/settings";
import { DocumentRow } from "./library/DocumentRow";
import { UploadModal } from "./UploadModal";
import { BatchImport } from "./library/BatchImport";
import { TopBar } from "./TopBar";
import { useToast } from "./ui/Toast";
import { DocumentEditModal } from "./DocumentEditModal";
import { ModuleSectionHeader, EmptyState } from "./library/LibraryParts";
import { groupBySemester } from "../lib/modules";
import { Menu, type MenuItem } from "./ui/Menu";
import { request } from "../lib/api/request";
import { AudiobookBatchDialog } from "./library/AudiobookBatchDialog";
import { AssignModuleDialog } from "./library/AssignModuleDialog";

type ModuleFilter = "all" | "unassigned" | string;

interface Props {
  onOpen: (docId: string) => void;
  onOpenModule?: (id: string) => void;
  onOpenSettings: () => void;
}

const TYPE_FILTERS: Array<"all" | DocType> = [
  "all",
  "studienheft",
  "script",
  "klausur",
  "uebung",
  "literatur",
  "sonstiges",
];

export function Library({
  onOpen,
  onOpenModule,
  onOpenSettings,
}: Props) {
  const [docs, setDocs] = useState<Document[] | null>(null);
  const [modules, setModules] = useState<ModuleListItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | DocType>("all");
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<Document | null>(null);
  // Auswahl für gemeinsame Aktionen; Dialoge für Hörbuch-Lauf und Modul-Zuordnung
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [audioFor, setAudioFor] = useState<string[] | null>(null);
  const [assignFor, setAssignFor] = useState<string[] | null>(null);
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

  function toggleSelect(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function removeDocs(ids: string[]) {
    const titles = (docs ?? []).filter((d) => ids.includes(d.id)).map((d) => d.title);
    if (!confirm(`${t("library.deleteConfirm")}\n\n${titles.join("\n")}`)) return;
    try {
      for (const id of ids) await api.documents.remove(id);
      toast.show(ids.length === 1 ? t("library.deleted", { title: titles[0] }) : t("library.deletedMany", { n: ids.length }), "success");
      setSelected((cur) => new Set([...cur].filter((x) => !ids.includes(x))));
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function reprocess(ids: string[]) {
    try {
      await api.batch.reprocess(ids);
      toast.show(t("library.retryStarted"), "success");
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  // Begriffsnetz für die gewählten Hefte im Hintergrund erfassen (Gemma, wartet auf freie Grafikkarte)
  async function captureConcepts(ids: string[]) {
    try {
      await request("/api/concepts/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docIds: ids, model: getSettings().defaultOllamaModel || undefined }) });
      toast.show(t("concepts.started", { n: ids.length }), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  // Gleiche Aktionen für eine Zeile und für die Auswahl
  function actionsFor(ids: string[]): MenuItem[] {
    const single = ids.length === 1 ? (docs ?? []).find((d) => d.id === ids[0]) : null;
    return [
      ...(single
        ? [
            { label: t("library.openDoc"), onClick: () => onOpen(single.id) },
            { label: t("common.edit"), onClick: () => setEditDoc(single) },
          ]
        : []),
      { label: t("batch.audio.menu"), onClick: () => setAudioFor(ids) },
      { label: t("concepts.start"), onClick: () => void captureConcepts(ids) },
      { label: t("library.reprocess"), onClick: () => void reprocess(ids) },
      ...(modules.length ? [{ label: t("library.assign.menu"), onClick: () => setAssignFor(ids) }] : []),
      { label: t("library.delete"), onClick: () => void removeDocs(ids), danger: true },
    ];
  }

  const visibleIds = (filtered ?? []).map((d) => d.id);
  const selectedIds = [...selected].filter((id) => visibleIds.includes(id));
  const allSelected = visibleIds.length > 0 && selectedIds.length === visibleIds.length;

  return (
    <div className="min-h-full flex flex-col">
      <TopBar
        onUpload={() => setUploadOpen(true)}
        onOpenDocument={onOpen}
        onOpenSettings={onOpenSettings}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        {/* Eine Werkzeugleiste: Typ, Modul, Ordner-Import */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <select className="input !w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as "all" | DocType)} aria-label={t("library.filter.type")}>
            {TYPE_FILTERS.map((ty) => (
              <option key={ty} value={ty}>
                {ty === "all" ? t("library.filter.allTypes") : t(`type.${ty}`)}
              </option>
            ))}
          </select>
          {modules.length > 0 && (
            <select className="input !w-auto min-w-[16rem]" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} aria-label={t("library.filter.module")}>
              <option value="all">{t("library.filter.allModules")}</option>
              <option value="unassigned">{t("library.filter.module.unassigned")}</option>
              {groupBySemester(modules).map((g) => (
                <optgroup key={g.semester ?? "none"} label={g.semester != null ? t("modules.semester", { n: g.semester }) : t("modules.noSemester")}>
                  {g.modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code ? `${m.code} · ` : ""}{m.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          <button type="button" className="chip ml-auto" onClick={() => setBatchOpen(true)}>
            ⇣ {t("batch.title")}
          </button>
        </div>

        {/* Auswahl: alle sichtbaren an- oder abwählen, gemeinsames Menü für die Auswahl */}
        {visibleIds.length > 0 && (
          <div className="flex items-center gap-4 mb-4 min-h-8 text-sm">
            <label className="flex items-center gap-2 cursor-pointer py-2 pl-6 pr-2 -ml-2">
              <input type="checkbox" className="w-5 h-5 cursor-pointer" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))} />
              {selectedIds.length ? t("library.selected", { n: selectedIds.length }) : t("library.selectAll")}
            </label>
            {selectedIds.length > 0 && <Menu items={actionsFor(selectedIds)} label={t("library.actionsSelected")} align="left" />}
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
                <ul className="card p-2 flex flex-col">
                  {section.docs.map((d) => (
                    <DocumentRow
                      key={d.id}
                      doc={d}
                      liveEvent={liveEvents[d.id]}
                      selected={selected.has(d.id)}
                      onSelect={() => toggleSelect(d.id)}
                      onOpen={() => onOpen(d.id)}
                      actions={actionsFor([d.id])}
                      onChanged={() => void load()}
                    />
                  ))}
                </ul>
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
                        <ul className="card p-2 flex flex-col">
                          {section.docs.map((d) => (
                            <DocumentRow
                              key={d.id}
                              doc={d}
                              liveEvent={liveEvents[d.id]}
                              selected={selected.has(d.id)}
                              onSelect={() => toggleSelect(d.id)}
                              onOpen={() => onOpen(d.id)}
                              actions={actionsFor([d.id])}
                              onChanged={() => void load()}
                            />
                          ))}
                        </ul>
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
      {audioFor && (
        <AudiobookBatchDialog
          docs={audioFor.map((id) => ({ id, title: (docs ?? []).find((d) => d.id === id)?.title ?? id }))}
          onClose={(started) => {
            setAudioFor(null);
            if (started) setSelected(new Set());
          }}
        />
      )}
      {assignFor && (
        <AssignModuleDialog
          docIds={assignFor}
          modules={modules}
          onClose={(changed) => {
            setAssignFor(null);
            if (changed) void load();
          }}
        />
      )}
      <BatchImport open={batchOpen} onClose={() => { setBatchOpen(false); void load(); }} modules={modules} />
    </div>
  );
}
