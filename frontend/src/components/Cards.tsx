import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  subscribeProgress,
  type Card,
  type CardStats,
  type Chapter,
  type ProgressEvent,
} from "../lib/api";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { useToast } from "./ui/Toast";
import { CardReview } from "./CardReview";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { renderMarkdown } from "../lib/markdown";

type Difficulty = "easy" | "medium" | "hard";

interface Props {
  docId: string;
}

export function Cards({ docId }: Props) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [stats, setStats] = useState<CardStats | null>(null);
  const [reviewing, setReviewing] = useState<Card[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filterChapter, setFilterChapter] = useState<string>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

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
    if (
      !confirm(t("cards.deleteConfirm", { preview: card.question.slice(0, 100) }))
    )
      return;
    try {
      await api.cards.remove(card.id);
      await load();
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
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              {t("cards.new")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setGenOpen(true)}
              disabled={busy}
              title={t("cards.generateTitle")}
            >
              {t("cards.generate")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setPrepOpen(true)}
              disabled={busy}
              title={t("cards.prepTitle")}
            >
              {t("cards.prep")}
            </Button>
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
              disabled={busy}
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
      <AddCardModal
        open={addOpen || !!editCard}
        docId={docId}
        chapters={chapters}
        editCard={editCard}
        onClose={() => {
          setAddOpen(false);
          setEditCard(null);
        }}
        onCreated={async () => {
          setAddOpen(false);
          setEditCard(null);
          await load();
        }}
      />
      <GenerateModal
        open={genOpen}
        docId={docId}
        onClose={() => setGenOpen(false)}
        onReload={load}
      />
      <PreprocessModal
        open={prepOpen}
        docId={docId}
        onClose={() => setPrepOpen(false)}
        onReload={load}
      />
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
  if (source === "extracted") return t("cards.source.extracted");
  if (source === "ai_generated") return t("cards.source.ai");
  if (source === "ai_filled") return t("cards.source.filled");
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
          aria-label="Umschalten"
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

function AddCardModal({
  open,
  docId,
  chapters,
  editCard,
  onClose,
  onCreated,
}: {
  open: boolean;
  docId: string;
  chapters: Array<{ id: string; title: string; number: number }>;
  editCard?: Card | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState("");
  const [chapterId, setChapterId] = useState<string>("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const editing = !!editCard;

  useEffect(() => {
    if (open) {
      setQuestion(editCard?.question ?? "");
      setAnswer(editCard?.answer ?? "");
      setHint(editCard?.hint ?? "");
      setChapterId(editCard?.chapter_id ?? "");
      setDifficulty(editCard?.difficulty ?? "medium");
    }
  }, [open, editCard]);

  async function submit() {
    if (!question.trim()) return;
    setBusy(true);
    try {
      if (editing && editCard) {
        await api.cards.patch(editCard.id, {
          question: question.trim(),
          answer: answer.trim(),
          hint: hint.trim() || null,
          difficulty,
        });
      } else {
        await api.cards.create({
          document_id: docId,
          chapter_id: chapterId || null,
          question: question.trim(),
          answer: answer.trim(),
          hint: hint.trim() || undefined,
          difficulty,
        });
      }
      onCreated();
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
      title={editing ? t("cards.modal.edit") : t("cards.modal.new")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !question.trim()}>
            {editing ? t("common.save") : t("cards.modal.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {chapters.length > 0 && !editing && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400">
              {t("cards.field.chapter")}
            </label>
            <select
              className="input"
              value={chapterId}
              onChange={(e) => setChapterId(e.target.value)}
            >
              <option value="">{t("common.none")}</option>
              {chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {String(ch.number).padStart(2, "0")} ·{" "}
                  {ch.title || `${t("learn.tab.chapters")} ${ch.number}`}
                </option>
              ))}
            </select>
          </div>
        )}
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

interface GenProgressState {
  phase: ProgressEvent["phase"] | null;
  extractTotal: number;
  extractMatched: number;
  fillTotal: number;
  fillCurrent: number;
  fillChapterNum: number | null;
  fillNote: "no-embedder" | "no-chunks" | null;
  errorMsg: string | null;
}

const initialGenState: GenProgressState = {
  phase: null,
  extractTotal: 0,
  extractMatched: 0,
  fillTotal: 0,
  fillCurrent: 0,
  fillChapterNum: null,
  fillNote: null,
  errorMsg: null,
};

function GenerateModal({
  open,
  docId,
  onClose,
  onReload,
}: {
  open: boolean;
  docId: string;
  onClose: () => void;
  onReload: () => Promise<void>;
}) {
  const [doExtract, setDoExtract] = useState(true);
  const [doFill, setDoFill] = useState(true);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<GenProgressState>(initialGenState);
  const toast = useToast();
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) {
      // Modal zu — Subscription sauber beenden, State reset.
      unsubRef.current?.();
      unsubRef.current = null;
      setState(initialGenState);
      setRunning(false);
    }
  }, [open]);

  // Close the stream on unmount — otherwise EventSource instances
  // leak when the user switches tabs while a run is active.
  useEffect(() => {
    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, []);

  async function start() {
    if (!doExtract && !doFill) return;
    setRunning(true);
    setState({ ...initialGenState, phase: "cards.start" });

    unsubRef.current?.();
    unsubRef.current = subscribeProgress(docId, (ev) => {
      if (!ev.phase.startsWith("cards.")) return;
      setState((prev) => {
        const next = { ...prev, phase: ev.phase };
        if (ev.phase === "cards.extract.done") {
          next.extractTotal = ev.total ?? 0;
          next.extractMatched = ev.current ?? 0;
        } else if (ev.phase === "cards.fill.start") {
          next.fillTotal = ev.total ?? 0;
          next.fillCurrent = 0;
          next.fillNote = null;
        } else if (ev.phase === "cards.fill.progress") {
          next.fillCurrent = ev.current ?? prev.fillCurrent;
          next.fillTotal = ev.total ?? prev.fillTotal;
          if (ev.message === "no-embedder") next.fillNote = "no-embedder";
          else if (ev.message === "no-chunks") next.fillNote = "no-chunks";
          if (ev.chapterNumber != null) next.fillChapterNum = ev.chapterNumber;
        } else if (ev.phase === "cards.fill.chapter") {
          if (ev.chapterNumber != null) next.fillChapterNum = ev.chapterNumber;
        } else if (ev.phase === "cards.done") {
          next.errorMsg = null;
        } else if (ev.phase === "cards.failed") {
          next.errorMsg = ev.message ?? "unknown";
        }
        return next;
      });

      if (ev.phase === "cards.done") {
        unsubRef.current?.();
        unsubRef.current = null;
        setRunning(false);
        void onReload();
        // Summary-Toast aus dem in message encodierten JSON lesen.
        let extracted = 0;
        let filled = 0;
        let fillTotal = 0;
        try {
          if (ev.message) {
            const parsed = JSON.parse(ev.message) as {
              extracted?: number;
              filled?: number;
              fillTotal?: number;
            };
            extracted = parsed.extracted ?? 0;
            filled = parsed.filled ?? 0;
            fillTotal = parsed.fillTotal ?? 0;
          }
        } catch {
          // ignore — fallback auf event totals
        }
        toast.show(
          t("cards.gen.doneToast", { extracted, filled, fillTotal }),
          "success"
        );
      } else if (ev.phase === "cards.failed") {
        unsubRef.current?.();
        unsubRef.current = null;
        setRunning(false);
        void onReload();
        toast.show(
          t("cards.gen.phase.failed", { msg: ev.message ?? "unknown" }),
          "error"
        );
      }
    });

    try {
      await api.cards.generate(docId, { extract: doExtract, fill: doFill });
    } catch (err) {
      unsubRef.current?.();
      unsubRef.current = null;
      setRunning(false);
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  const percent =
    running && state.fillTotal > 0
      ? Math.min(100, Math.round((state.fillCurrent / state.fillTotal) * 100))
      : running && state.phase === "cards.extract.done"
      ? 100
      : 0;

  const status = phaseMessage(state);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("cards.gen.title")}
      footer={
        running ? (
          <Button variant="ghost" onClick={onClose}>
            {t("cards.gen.keepRunning")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("cards.gen.cancel")}
            </Button>
            <Button
              onClick={start}
              disabled={!doExtract && !doFill}
            >
              {t("cards.gen.submit")}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-neutral-500">{t("cards.gen.description")}</p>

        <label className="flex items-start gap-3 p-3 rounded border border-border hover:border-border-strong transition-colors cursor-pointer">
          <input
            type="checkbox"
            checked={doExtract}
            onChange={(e) => setDoExtract(e.target.checked)}
            disabled={running}
            className="mt-1 accent-accent"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-neutral-100">
              {t("cards.gen.stepExtract")}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">
              {t("cards.gen.stepExtractHint")}
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 p-3 rounded border border-border hover:border-border-strong transition-colors cursor-pointer">
          <input
            type="checkbox"
            checked={doFill}
            onChange={(e) => setDoFill(e.target.checked)}
            disabled={running}
            className="mt-1 accent-accent"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-neutral-100">
              {t("cards.gen.stepFill")}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">
              {t("cards.gen.stepFillHint")}
            </div>
          </div>
        </label>

        {(running || state.phase) && (
          <div className="card p-3 flex flex-col gap-2 border-accent-subtle">
            {status && <div className="text-sm text-neutral-200">{status}</div>}
            {state.fillTotal > 0 && (
              <div className="h-1.5 bg-neutral-800 rounded overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
            {state.fillNote === "no-embedder" && (
              <div className="text-xs text-amber-400">
                {t("cards.gen.phase.noEmbedder")}
              </div>
            )}
            {state.fillNote === "no-chunks" && (
              <div className="text-xs text-amber-400">
                {t("cards.gen.phase.noChunks")}
              </div>
            )}
            {state.errorMsg && (
              <div className="text-xs text-red-400">
                {t("cards.gen.phase.failed", { msg: state.errorMsg })}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function phaseMessage(s: GenProgressState): string | null {
  switch (s.phase) {
    case "cards.start":
      return t("cards.gen.phase.start");
    case "cards.extract.done": {
      const gaps = Math.max(0, s.extractTotal - s.extractMatched);
      return t("cards.gen.phase.extractDone", {
        current: s.extractMatched,
        total: s.extractTotal,
        gaps,
      });
    }
    case "cards.fill.start":
    case "cards.fill.chapter":
    case "cards.fill.progress": {
      const base = t("cards.gen.phase.filling", {
        current: s.fillCurrent,
        total: s.fillTotal,
      });
      if (s.fillChapterNum != null) {
        return `${base} · ${t("cards.gen.phase.fillChapter", { num: s.fillChapterNum })}`;
      }
      return base;
    }
    case "cards.done":
      return t("cards.gen.phase.done");
    case "cards.failed":
      return null;
    default:
      return null;
  }
}

// Re-exported because some callers may want the shared Input style.
void Input;

// ---------------------------------------------------------------------
// Card preprocess modal — per-chapter classify (Klausur vs Lehrtext)
// and either extract Q&A pairs (and import as cards) or rewrite the
// content with LaTeX-clean formulas for the AI card-gen to consume.
// ---------------------------------------------------------------------

type PrepStatus =
  | { state: "unknown" }
  | { state: "loading" }
  | { state: "ready"; type: "qa_pairs" | "content"; length: number }
  | { state: "running" }
  | {
      state: "result";
      type: "qa_pairs" | "content";
      pairCount?: number;
      contentLength?: number;
    }
  | { state: "error"; message: string };

function PreprocessModal({
  open,
  docId,
  onClose,
  onReload,
}: {
  open: boolean;
  docId: string;
  onClose: () => void;
  onReload: () => Promise<void>;
}) {
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [status, setStatus] = useState<Record<string, PrepStatus>>({});
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    api.chapters
      .list(docId)
      .then(async (chs) => {
        setChapters(chs);
        // Lade aktuellen Preprocess-Status für jedes Kapitel parallel.
        const entries = await Promise.all(
          chs.map(async (ch) => {
            try {
              const r = await api.cards.preprocessStatus(ch.id);
              const v: PrepStatus = r.preprocessed
                ? {
                    state: "ready",
                    type: (r.type as "qa_pairs" | "content") ?? "content",
                    length: r.length,
                  }
                : { state: "unknown" };
              return [ch.id, v] as const;
            } catch {
              return [ch.id, { state: "unknown" } as PrepStatus] as const;
            }
          })
        );
        setStatus(Object.fromEntries(entries));
      })
      .catch(() => setChapters([]));
  }, [open, docId]);

  async function runPreprocess(chapterId: string, force: boolean) {
    setStatus((s) => ({ ...s, [chapterId]: { state: "running" } }));
    try {
      const r = await api.cards.preprocess(chapterId, { force });
      setStatus((s) => ({
        ...s,
        [chapterId]: {
          state: "result",
          type: r.type,
          pairCount: r.pairCount,
          contentLength: r.contentLength,
        },
      }));
    } catch (err) {
      setStatus((s) => ({
        ...s,
        [chapterId]: {
          state: "error",
          message: err instanceof Error ? err.message : "Fehler",
        },
      }));
    }
  }

  async function importQa(chapterId: string) {
    try {
      const r = await api.cards.importQa(chapterId, "medium");
      toast.show(
        t("cards.prep.imported", { n: r.inserted, skipped: r.skipped }),
        "success"
      );
      await onReload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("cards.prep.title")}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-neutral-500">{t("cards.prep.description")}</p>
        {!chapters && (
          <div className="text-sm text-neutral-500">{t("common.loading")}</div>
        )}
        {chapters && chapters.length === 0 && (
          <div className="text-sm text-neutral-500 italic">
            {t("cards.prep.noChapters")}
          </div>
        )}
        {chapters && chapters.length > 0 && (
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1">
            {chapters.map((ch) => {
              const st = status[ch.id] ?? { state: "unknown" };
              return (
                <div
                  key={ch.id}
                  className="border border-border rounded p-3 flex flex-col gap-2"
                >
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs text-neutral-500 tabular-nums">
                      {String(ch.number).padStart(2, "0")}
                    </span>
                    <span className="text-sm text-neutral-100 truncate">
                      {ch.title || `Kapitel ${ch.number}`}
                    </span>
                    <PrepBadge status={st} />
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      onClick={() => runPreprocess(ch.id, st.state === "ready")}
                      disabled={st.state === "running"}
                      className="!py-1 !px-2 text-xs"
                    >
                      {st.state === "running"
                        ? t("cards.prep.processing")
                        : st.state === "ready" || st.state === "result"
                          ? t("cards.prep.redo")
                          : t("cards.prep.run")}
                    </Button>
                    {(st.state === "ready" && st.type === "qa_pairs") ||
                    (st.state === "result" && st.type === "qa_pairs") ? (
                      <Button
                        variant="primary"
                        onClick={() => importQa(ch.id)}
                        className="!py-1 !px-2 text-xs"
                      >
                        {t("cards.prep.importQa")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PrepBadge({ status }: { status: PrepStatus }) {
  if (status.state === "unknown")
    return (
      <span className="text-[11px] text-neutral-500 px-1.5 py-0.5 rounded border border-border">
        {t("cards.prep.badge.unknown")}
      </span>
    );
  if (status.state === "loading" || status.state === "running")
    return (
      <span className="text-[11px] text-neutral-400 px-1.5 py-0.5 rounded border border-border">
        ⋯
      </span>
    );
  if (status.state === "error")
    return (
      <span
        className="text-[11px] text-accent px-1.5 py-0.5 rounded border border-accent-subtle"
        title={status.message}
      >
        {t("cards.prep.badge.error")}
      </span>
    );
  // ready or result
  const isQa = status.type === "qa_pairs";
  const label = isQa
    ? "result" in status && status.state === "result"
      ? t("cards.prep.badge.qaCount", { n: status.pairCount ?? 0 })
      : t("cards.prep.badge.qa")
    : t("cards.prep.badge.content");
  return (
    <span
      className={cn(
        "text-[11px] px-1.5 py-0.5 rounded border",
        isQa
          ? "text-emerald-300 border-emerald-700/50 bg-emerald-700/10"
          : "text-blue-300 border-blue-700/50 bg-blue-700/10"
      )}
    >
      {label}
    </span>
  );
}
