// Modul → Material: Merksätze, Formeln, Aufgaben, Rezepte; Filter, Suche, Prüfliste, Druck
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type MaterialCounts, type MaterialItem, type MaterialKind, type ModuleDocument } from "../../lib/api";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { MaterialItemCard } from "./MaterialItemCard";
import { MaterialExtract } from "./MaterialExtract";

const KINDS: MaterialKind[] = ["merksatz", "formel", "rezept", "aufgabe"];
type Filter = MaterialKind | "all" | "uncertain";

export function MaterialPanel({
  moduleId,
  moduleName,
  docs,
  onOpenDocument,
}: {
  moduleId: string;
  moduleName: string;
  docs: ModuleDocument[];
  onOpenDocument: (id: string) => void;
}) {
  const [items, setItems] = useState<MaterialItem[] | null>(null);
  const [counts, setCounts] = useState<MaterialCounts | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const toast = useToast();

  const load = useCallback(async () => {
    const r = await api.study.material(moduleId);
    setItems(r.items);
    setCounts(r.counts);
  }, [moduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (it) =>
        (filter === "all" || (filter === "uncertain" ? it.uncertain : it.kind === filter)) &&
        (!q || it.id.toLowerCase().includes(q) || it.title.toLowerCase().includes(q) || it.body_md.toLowerCase().includes(q))
    );
  }, [items, filter, query]);

  async function catalog() {
    try {
      const r = await api.study.buildCatalog(moduleId, { audio: true, cards: true });
      toast.show(t("material.catalogDone", { cards: r.cards, chapters: r.chapters, skipped: r.skippedUncertain }), "success");
      onOpenDocument(r.documentId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  if (!items || !counts) return <div className="text-sm text-neutral-500">{t("common.loading")}</div>;

  const total = KINDS.reduce((n, k) => n + counts[k], 0);
  const chip = (id: Filter, label: string, n: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      className={cn("chip", filter === id && "chip-active", id === "uncertain" && n > 0 && filter !== id && "text-amber-600")}
    >
      {label} <span className="tabular-nums opacity-70">{n}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <MaterialExtract moduleId={moduleId} docs={docs} tasks={counts.aufgabe} onDone={() => void load()} />

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {chip("all", t("material.all"), total)}
        {KINDS.map((k) => chip(k, t(`material.kind.${k}`), counts[k]))}
        {chip("uncertain", t("material.toCheck"), counts.uncertain)}
        <input className="input !w-full sm:!w-56 sm:ml-auto" placeholder={t("material.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="outline" onClick={() => void catalog()} disabled={!counts.merksatz && !counts.formel} title={t("material.catalogHint")}>
          {t("material.catalog")}
        </Button>
        <Button variant="outline" onClick={() => window.print()} disabled={!shown.length}>
          {t("material.print")}
        </Button>
      </div>

      <div className="print-area flex flex-col gap-6">
        <h2 className="hidden print:block text-xl font-semibold">
          {moduleName} · {filter === "all" ? t("material.all") : filter === "uncertain" ? t("material.toCheck") : t(`material.kind.${filter}`)}
        </h2>
        {!shown.length && <div className="card p-8 text-center text-sm text-neutral-500">{total ? t("material.noMatch") : t("material.empty")}</div>}
        {KINDS.map((k) => {
          const list = shown.filter((it) => it.kind === k);
          if (!list.length) return null;
          return (
            <section key={k} className="flex flex-col gap-2">
              <h3 className="text-xs uppercase tracking-wide text-neutral-500">
                {t(`material.kind.${k}`)} · {list.length}
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 print:block print:columns-1">
                {list.map((it) => (
                  <MaterialItemCard key={it.id} item={it} onChanged={() => void load()} onOpenDocument={onOpenDocument} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
