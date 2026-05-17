import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  subscribeProgress,
  type Card,
  type CardStats,
  type ProgressEvent,
} from "../lib/api";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { useToast } from "./ui/Toast";
import { CardReview } from "./CardReview";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { renderMarkdown } from "../lib/markdown";

type Difficulty = "easy" | "medium" | "hard";

interface Props {
  docId: string;
}

interface BuildState {
  active: boolean;
  chapterCurrent: number;
  chapterTotal: number;
  chapterTitle: string | null;
  chunkCurrent: number;
  chunkTotal: number;
  cardsCount: number;
  error: string | null;
  finished: "done" | "failed" | "canceled" | null;
}

const INITIAL_BUILD: BuildState = {
  active: false,
  chapterCurrent: 0,
  chapterTotal: 0,
  chapterTitle: null,
  chunkCurrent: 0,
  chunkTotal: 0,
  cardsCount: 0,
  error: null,
  finished: null,
};

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

  // Recover after refresh: ask the server whether a build is still
  // running, and either re-subscribe or just sit idle. Without this,
  // refreshing the page mid-build would lose the progress display.
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

  // SSE subscription is always-on. Phases outside cards.* are ignored
  // here (audiobook reuses the same channel).
  useEffect(() => {
    const unsub = subscribeProgress(docId, (ev) => {
      if (!ev.phase.startsWith("cards.")) return;
      setBuild((prev) => reduceBuild(prev, ev));
      // Live-reload list + stats on every progress hop so the user sees
      // cards appearing as they're extracted, not just at the end.
      // cards.chapter / cards.progress fire often; load() is cheap (one
      // SELECT each). cards.done / canceled / failed also reload to be
      // sure.
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
    // Resume: keep what we have, walk un-processed chapters.
    setBuild({ ...INITIAL_BUILD, active: true });
    try {
      await api.cards.build(docId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("common.error");
      toast.show(msg, "error");
      setBuild({ ...INITIAL_BUILD, error: msg, finished: "failed" });
    }
  }

  async function buildRebuild() {
    // Confirm + wipe + start over.
    if (
      stats &&
      stats.total > 0 &&
      !confirm(t("cards.build.replaceConfirm", { n: stats.total }))
    )
      return;
    setBuild({ ...INITIAL_BUILD, active: true });
    try {
      await api.cards.build(docId, { rebuild: true });
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

function reduceBuild(prev: BuildState, ev: ProgressEvent): BuildState {
  switch (ev.phase) {
    case "cards.start":
      return {
        ...INITIAL_BUILD,
        active: true,
        chapterTotal: ev.total ?? 0,
      };
    case "cards.chapter":
      return {
        ...prev,
        active: true,
        chapterCurrent: (ev.current ?? 0) + 1,
        chapterTotal: ev.total ?? prev.chapterTotal,
        chapterTitle: ev.message ?? null,
        chunkCurrent: 0,
        chunkTotal: 0,
      };
    case "cards.chunk":
      return {
        ...prev,
        active: true,
        chunkCurrent: ev.current ?? 0,
        chunkTotal: ev.total ?? 0,
      };
    case "cards.progress":
      return {
        ...prev,
        active: true,
        cardsCount: ev.current ?? prev.cardsCount,
      };
    case "cards.done":
      return {
        ...prev,
        active: false,
        chapterCurrent: prev.chapterTotal,
        chunkCurrent: prev.chunkTotal,
        cardsCount: ev.current ?? prev.cardsCount,
        finished: "done",
      };
    case "cards.canceled":
      return { ...prev, active: false, finished: "canceled" };
    case "cards.failed":
      return {
        ...prev,
        active: false,
        finished: "failed",
        error: ev.message ?? "unknown",
      };
    default:
      return prev;
  }
}

function BuildProgressPanel({ state }: { state: BuildState }) {
  const chapterPct =
    state.chapterTotal > 0
      ? Math.round(((state.chapterCurrent - 1) / state.chapterTotal) * 100)
      : 0;
  const chunkPct =
    state.chunkTotal > 0
      ? Math.round((state.chunkCurrent / state.chunkTotal) * 100)
      : 0;

  return (
    <div
      className={cn(
        "border rounded-md p-3 flex flex-col gap-2 text-xs font-mono",
        state.finished === "failed"
          ? "border-accent-subtle bg-accent/5"
          : state.finished === "canceled"
            ? "border-border bg-bg-elevated"
            : "border-accent-subtle bg-accent/5"
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "uppercase tracking-wide",
            state.finished === "failed" ? "text-accent" : "text-accent"
          )}
        >
          {state.finished === "done"
            ? t("cards.build.donePhase")
            : state.finished === "failed"
              ? t("cards.build.failedPhase")
              : state.finished === "canceled"
                ? t("cards.build.canceledPhase")
                : t("cards.build.runningPhase")}
        </span>
        <span className="text-neutral-500">
          {t("cards.build.cardsSoFar", { n: state.cardsCount })}
        </span>
      </div>

      {state.chapterTotal > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-neutral-400 truncate">
              {t("cards.build.chapterLabel", {
                current: Math.max(1, state.chapterCurrent),
                total: state.chapterTotal,
              })}
              {state.chapterTitle ? ` — ${state.chapterTitle}` : ""}
            </span>
            <span className="text-neutral-500 shrink-0">{chapterPct}%</span>
          </div>
          <div className="h-1 bg-black/40 rounded overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${chapterPct}%` }}
            />
          </div>
        </div>
      )}

      {state.chunkTotal > 0 && state.active && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-neutral-500">
              {t("cards.build.chunkLabel", {
                current: state.chunkCurrent,
                total: state.chunkTotal,
              })}
            </span>
            <span className="text-neutral-500 shrink-0">{chunkPct}%</span>
          </div>
          <div className="h-1 bg-black/40 rounded overflow-hidden">
            <div
              className="h-full bg-accent/60 transition-all"
              style={{ width: `${chunkPct}%` }}
            />
          </div>
        </div>
      )}

      {state.error && (
        <p className="text-accent text-[11px] mt-1 break-words">{state.error}</p>
      )}
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={cn(
        "card p-3 text-center",
        accent && value > 0 ? "border-accent-subtle bg-accent/5" : ""
      )}
    >
      <div className={cn("text-2xl font-semibold", accent && value > 0 ? "text-accent" : "")}>
        {value}
      </div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
    </div>
  );
}

function sourceLabel(source: Card["source"]): string {
  if (source === "ai_generated") return t("cards.source.ai");
  return t("cards.source.manual");
}

function CardRow({
  card,
  onDelete,
  onEdit,
}: {
  card: Card;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card card-hover p-4">
      <div className="flex items-start gap-3">
        <button
          onClick={() => setOpen(!open)}
          className="text-xs text-accent w-5 flex-shrink-0 mt-1"
          aria-label="toggle"
        >
          {open ? "▾" : "▸"}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-neutral-100 line-clamp-2">
            {renderMarkdown(card.question)}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-neutral-500 mt-1">
            {card.chapter_number && (
              <span>
                {t("library.chaptersShort")} {String(card.chapter_number).padStart(2, "0")}
              </span>
            )}
            <span>·</span>
            <span>{sourceLabel(card.source)}</span>
            {card.hint && (
              <>
                <span>·</span>
                <span className="text-amber-400">{t("cards.hintChip")}</span>
              </>
            )}
            {typeof card.reps === "number" && card.reps > 0 && (
              <>
                <span>·</span>
                <span>{t("cards.reviewed", { n: card.reps })}</span>
              </>
            )}
          </div>
          {open && (
            <div className="mt-3 pt-3 border-t border-border text-sm text-neutral-300 space-y-2">
              {card.hint && (
                <div className="text-amber-400/90 text-xs italic">
                  💡 {renderMarkdown(card.hint)}
                </div>
              )}
              {card.answer ? (
                <div>{renderMarkdown(card.answer)}</div>
              ) : (
                <span className="text-neutral-500 italic">{t("cards.noAnswer")}</span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onEdit}
          className="text-xs text-neutral-500 hover:text-accent"
          aria-label={t("common.edit")}
          title={t("common.edit")}
        >
          ✎
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-neutral-500 hover:text-accent"
          aria-label={t("common.delete")}
          title={t("common.delete")}
        >
          ✕
        </button>
      </div>
    </li>
  );
}

function EditCardModal({
  open,
  card,
  onClose,
  onSaved,
}: {
  open: boolean;
  card: Card | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open && card) {
      setQuestion(card.question);
      setAnswer(card.answer ?? "");
      setHint(card.hint ?? "");
      setDifficulty(card.difficulty ?? "medium");
    }
  }, [open, card]);

  async function submit() {
    if (!card || !question.trim()) return;
    setBusy(true);
    try {
      await api.cards.patch(card.id, {
        question: question.trim(),
        answer: answer.trim(),
        hint: hint.trim() || null,
        difficulty,
      });
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
      title={t("cards.modal.edit")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !question.trim()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-400">
            {t("cards.field.question")}
          </label>
          <textarea
            className="input min-h-[90px] resize-y"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-400">
            {t("cards.field.answer")}
          </label>
          <textarea
            className="input min-h-[90px] resize-y"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-400">
            {t("cards.field.hint")}
          </label>
          <textarea
            className="input min-h-[60px] resize-y"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-400">
            {t("cards.field.difficulty")}
          </label>
          <select
            className="input"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
          >
            <option value="easy">{t("cards.diff.easy")}</option>
            <option value="medium">{t("cards.diff.medium")}</option>
            <option value="hard">{t("cards.diff.hard")}</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}
