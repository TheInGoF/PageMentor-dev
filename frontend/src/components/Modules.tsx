import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ModuleListItem, type Module } from "../lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { t, useLocale } from "../lib/i18n";
import { cn } from "../lib/cn";
import { TopBar } from "./TopBar";
import { ModuleEditModal } from "./module/ModuleEditModal";
import { distinctAreas, distinctSemesters, groupBySemester, semesterOf } from "../lib/modules";

type SortKey = "semester" | "name" | "code" | "due";
interface Filter {
  q: string;
  semester: string;
  area: string;
  status: "active" | "completed" | "all";
  sort: SortKey;
}
const FILTER_KEY = "pm_modules_filter";
const DEFAULT_FILTER: Filter = { q: "", semester: "", area: "", status: "active", sort: "semester" };

function loadFilter(): Filter {
  try {
    return { ...DEFAULT_FILTER, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}") };
  } catch {
    return DEFAULT_FILTER;
  }
}

interface Props {
  onOpenModule: (moduleId: string) => void;
  onOpenDocument: (docId: string) => void;
  onOpenSettings: () => void;
}

export function Modules({
  onOpenModule,
  onOpenDocument,
  onOpenSettings,
}: Props) {
  useLocale();
  const [modules, setModules] = useState<ModuleListItem[] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editModule, setEditModule] = useState<Module | null>(null);
  const [filter, setFilterState] = useState<Filter>(loadFilter);
  const setFilter = (patch: Partial<Filter>) =>
    setFilterState((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(FILTER_KEY, JSON.stringify(next));
      } catch {
        // ohne Speicher: Filter gilt nur bis zum Neuladen
      }
      return next;
    });
  const toast = useToast();

  const semesters = useMemo(() => distinctSemesters(modules ?? []), [modules]);
  const areas = useMemo(() => distinctAreas(modules ?? []), [modules]);
  const shown = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    const list = (modules ?? []).filter((m) => {
      if (filter.status === "active" && m.completed) return false;
      if (filter.status === "completed" && !m.completed) return false;
      if (filter.semester && String(semesterOf(m) ?? "") !== filter.semester) return false;
      if (filter.area && (m.area ?? "") !== filter.area) return false;
      if (q && !`${m.name} ${m.code ?? ""} ${m.area ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const by: Record<SortKey, (a: ModuleListItem, b: ModuleListItem) => number> = {
      semester: (a, b) => (semesterOf(a) ?? 99) - (semesterOf(b) ?? 99) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      code: (a, b) => (a.code ?? "~").localeCompare(b.code ?? "~"),
      due: (a, b) => b.card_due - a.card_due || a.name.localeCompare(b.name),
    };
    return [...list].sort(by[filter.sort]);
  }, [modules, filter]);
  const groups = filter.sort === "semester" ? groupBySemester(shown) : [{ semester: null, modules: shown }];

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
        onOpenDocument={onOpenDocument}
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
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input !w-auto flex-1 min-w-[12rem]" placeholder={t("modules.search")} value={filter.q} onChange={(e) => setFilter({ q: e.target.value })} />
              <select className="input !w-auto" value={filter.semester} onChange={(e) => setFilter({ semester: e.target.value })} aria-label={t("modules.filter.semester")}>
                <option value="">{t("modules.filter.allSemesters")}</option>
                {semesters.map((n) => (
                  <option key={n} value={String(n)}>{t("modules.semester", { n })}</option>
                ))}
              </select>
              <select className="input !w-auto" value={filter.area} onChange={(e) => setFilter({ area: e.target.value })} aria-label={t("modules.filter.area")}>
                <option value="">{t("modules.filter.allAreas")}</option>
                {areas.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <select className="input !w-auto" value={filter.status} onChange={(e) => setFilter({ status: e.target.value as Filter["status"] })} aria-label={t("modules.filter.status")}>
                <option value="active">{t("modules.filter.active")}</option>
                <option value="completed">{t("modules.filter.completed")}</option>
                <option value="all">{t("modules.filter.allStatus")}</option>
              </select>
              <select className="input !w-auto" value={filter.sort} onChange={(e) => setFilter({ sort: e.target.value as SortKey })} aria-label={t("modules.sort")}>
                <option value="semester">{t("modules.sort.semester")}</option>
                <option value="name">{t("modules.sort.name")}</option>
                <option value="code">{t("modules.sort.code")}</option>
                <option value="due">{t("modules.sort.due")}</option>
              </select>
            </div>
            {shown.length === 0 && <p className="text-sm text-neutral-500">{t("modules.noMatch")}</p>}
            {groups.map((g) => (
              <section key={g.semester ?? "all"} className="flex flex-col gap-4">
                {filter.sort === "semester" && (
                  <h2 className="text-base font-semibold">{g.semester != null ? t("modules.semester", { n: g.semester }) : t("modules.noSemester")}</h2>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {g.modules.map((m) => (
                    <ModuleCard key={m.id} module={m} onOpen={() => onOpenModule(m.id)} onEdit={() => openEdit(m)} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>

      <ModuleEditModal
        open={editOpen}
        module={editModule}
        areas={areas}
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
      className="card card-hover p-4 flex flex-col gap-2 cursor-pointer group"
      onClick={onOpen}
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
            <p className="text-xs text-neutral-500">
              {[m.code, m.cp != null ? `${m.cp} CP` : null, semesterOf(m) != null ? t("modules.semester", { n: semesterOf(m)! }) : null].filter(Boolean).join(" · ")}
            </p>
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

      <div className="flex items-center gap-2 flex-wrap text-xs">
        {m.area && <span className="tag" style={{ borderColor: m.color }}>{m.area}</span>}
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
      <div className="text-xs text-neutral-500 uppercase tracking-wide">
        {label}
      </div>
    </div>
  );
}
