// Karten-Tab: Liste, Erzeugung, Wiederholung
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  subscribeProgress,
  type Card,
  type CardStats,
} from "../lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { CardReview } from "./CardReview";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { getSettings } from "../lib/settings";
import { INITIAL_BUILD, reduceBuild, BuildProgressPanel, type BuildState } from "./cards/buildProgress";
import { CardRow, StatPill } from "./cards/CardRow";
import { EditCardModal } from "./cards/EditCardModal";

export type Difficulty = "easy" | "medium" | "hard";

interface Props {
  docId: string;
}


export function Cards({ docId }: Props) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [stats, setStats] = useState<CardStats | null>(null);
  const [reviewing, setReviewing] = useState<Card[] | null>(null);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [filterChapter, setFilterChapter] = useState<string>("all");
  const [build, setBuild] = useState<BuildState>(INITIAL_BUILD);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [cs, st] = await Promise.all([api.cards.list(docId), api.cards.stats(docId)]);
      setCards(cs);
      setStats(st);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }, [docId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Nach Reload: läuft noch ein Build? Dann Fortschritt wieder anzeigen
  useEffect(() => {
    let mounted = true;
    api.cards
      .buildStatus(docId)
      .then((r) => {
        if (!mounted) return;
        if (r.active) setBuild((b) => ({ ...b, active: true }));
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [docId]);

  // SSE immer aktiv, nur cards.*-Phasen zählen
  useEffect(() => {
    const unsub = subscribeProgress(docId, (ev) => {
      if (!ev.phase.startsWith("cards.")) return;
      setBuild((prev) => reduceBuild(prev, ev));
      // Liste und Statistik bei jedem Schritt neu laden: Karten erscheinen live
      if (
        ev.phase === "cards.progress" ||
        ev.phase === "cards.chapter" ||
        ev.phase === "cards.done" ||
        ev.phase === "cards.canceled" ||
        ev.phase === "cards.failed"
      ) {
        void load();
      }
    });
    return unsub;
  }, [docId, load]);

  async function importCsv(file: File) {
    setBusy(true);
    try {
      const res = await api.cards.importCsv(docId, file);
      toast.show(t("cards.importedToast", { n: res.imported }), "success");
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function startReview() {
    try {
      const due = await api.cards.due(docId);
      if (due.length === 0) {
        toast.show(t("cards.learnNoneDue"), "success");
        return;
      }
      setReviewing(due);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function remove(card: Card) {
    if (!confirm(t("cards.deleteConfirm", { preview: card.question.slice(0, 100) })))
      return;
    try {
      await api.cards.remove(card.id);
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function buildResume() {
    // Fortsetzen mit dem Modell aus den Einstellungen, wie im Hörbuch-Tab
    setBuild({ ...INITIAL_BUILD, active: true });
    try {
      await api.cards.build(docId, {
        model: getSettings().defaultOllamaModel || undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      toast.show(msg, "error");
      setBuild({ ...INITIAL_BUILD, error: msg, finished: "failed" });
    }
  }

  async function buildRebuild() {
    if (
      stats &&
      stats.total > 0 &&
      !confirm(t("cards.build.replaceConfirm", { n: stats.total }))
    )
      return;
    setBuild({ ...INITIAL_BUILD, active: true });
    try {
      await api.cards.build(docId, {
        rebuild: true,
        model: getSettings().defaultOllamaModel || undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      toast.show(msg, "error");
      setBuild({ ...INITIAL_BUILD, error: msg, finished: "failed" });
    }
  }

  async function cancelBuild() {
    try {
      await api.cards.buildCancel(docId);
      toast.show(t("cards.build.canceling"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  const chapters = useMemo(() => {
    if (!cards) return [];
    const map = new Map<string, { id: string; title: string; number: number }>();
    for (const c of cards) {
      if (c.chapter_id && !map.has(c.chapter_id)) {
        map.set(c.chapter_id, {
          id: c.chapter_id,
          title: c.chapter_title ?? "",
          number: c.chapter_number ?? 0,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.number - b.number);
  }, [cards]);

  const filtered = useMemo(() => {
    if (!cards) return [];
    if (filterChapter === "all") return cards;
    return cards.filter((c) => c.chapter_id === filterChapter);
  }, [cards, filterChapter]);

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">{t("cards.title")}</h2>
            <p className="text-xs text-neutral-500 mt-1">{t("cards.subtitle")}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {build.active ? (
              <Button variant="danger" onClick={cancelBuild}>
                {t("cards.build.cancel")}
              </Button>
            ) : (
              <>
                <Button onClick={buildResume} disabled={busy}>
                  {stats && stats.total > 0
                    ? t("cards.build.resume")
                    : t("cards.build.start")}
                </Button>
                {stats && stats.total > 0 && (
                  <Button
                    variant="outline"
                    onClick={buildRebuild}
                    disabled={busy}
                    title={t("cards.build.rerunTitle")}
                  >
                    {t("cards.build.rerun")}
                  </Button>
                )}
              </>
            )}
            {(stats?.total ?? 0) > 0 && !build.active && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!confirm(t("cards.deleteAllConfirm", { n: stats?.total ?? 0 }))) return;
                  setBusy(true);
                  try {
                    const r = await api.cards.deleteAll(docId);
                    toast.show(t("cards.deleteAllDone", { n: r.deleted }), "success");
                    await load();
                  } catch (err) {
                    toast.show(
                      err instanceof Error ? err.message : t("common.error"),
                      "error"
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
                title={t("cards.deleteAllTitle")}
                className="text-accent hover:text-accent"
              >
                {t("cards.deleteAll")}
              </Button>
            )}
            {(stats?.total ?? 0) > 0 && (
              <a
                href={api.cards.exportUrl(docId, "csv")}
                download
                className="btn-ghost text-xs"
                title={t("cards.exportTitle")}
              >
                {t("cards.exportCsv")}
              </a>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importCsv(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || build.active}
              className="text-xs"
              title={t("cards.importTitle")}
            >
              {t("cards.importCsv")}
            </Button>
            {(stats?.total ?? 0) > 0 && (
              <Button onClick={startReview} disabled={busy || (stats?.due ?? 0) === 0}>
                {t("cards.learn", { n: stats?.due ?? 0 })}
              </Button>
            )}
          </div>
        </div>

        {(build.active || build.finished) && <BuildProgressPanel state={build} />}

        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <StatPill label={t("cards.stats.total")} value={stats.total} />
            <StatPill label={t("cards.stats.due")} value={stats.due} accent={stats.due > 0} />
            <StatPill label={t("cards.stats.learned")} value={stats.learned} />
          </div>
        )}

        {chapters.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border">
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              {t("cards.filter.chapter")}
            </span>
            <button
              onClick={() => setFilterChapter("all")}
              className={cn(
                "px-3 py-1 rounded-full text-xs border transition-colors",
                filterChapter === "all"
                  ? "bg-accent/15 border-accent-subtle text-accent"
                  : "border-border text-neutral-400 hover:border-border-strong"
              )}
            >
              {t("common.all")}
            </button>
            {chapters.map((ch) => (
              <button
                key={ch.id}
                onClick={() => setFilterChapter(ch.id)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs border transition-colors",
                  filterChapter === ch.id
                    ? "bg-accent/15 border-accent-subtle text-accent"
                    : "border-border text-neutral-400 hover:border-border-strong"
                )}
              >
                {String(ch.number).padStart(2, "0")} ·{" "}
                {ch.title || `${t("learn.tab.chapters")} ${ch.number}`}
              </button>
            ))}
          </div>
        )}
      </section>

      {!cards ? (
        <div className="text-sm text-neutral-500">{t("common.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-neutral-500">
          {cards.length === 0 ? t("cards.empty.none") : t("cards.empty.filter")}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((card) => (
            <CardRow
              key={card.id}
              card={card}
              onDelete={() => remove(card)}
              onEdit={() => setEditCard(card)}
            />
          ))}
        </ul>
      )}

      {reviewing && (
        <CardReview
          cards={reviewing}
          onClose={async () => {
            setReviewing(null);
            await load();
          }}
        />
      )}
      <EditCardModal
        open={!!editCard}
        card={editCard}
        onClose={() => setEditCard(null)}
        onSaved={async () => {
          setEditCard(null);
          await load();
        }}
      />
    </div>
  );
}
