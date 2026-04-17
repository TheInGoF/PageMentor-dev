import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Card, type CardStats } from "../lib/api";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { useToast } from "./ui/Toast";
import { CardReview } from "./CardReview";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";

type Difficulty = "easy" | "medium" | "hard";
type Style = "basic" | "deep" | "exam";

interface Props {
  docId: string;
}

export function Cards({ docId }: Props) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [stats, setStats] = useState<CardStats | null>(null);
  const [reviewing, setReviewing] = useState<Card[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
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

  async function extract(replace: boolean) {
    setBusy(true);
    try {
      const res = await api.cards.extract(docId, replace);
      toast.show(t("cards.extractedToast", { n: res.extracted }), "success");
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
            <Button variant="outline" onClick={() => extract(false)} disabled={busy}>
              {busy ? "…" : t("cards.extract")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setAiOpen(true)}
              disabled={busy || chapters.length === 0}
            >
              {t("cards.ai")}
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
      <AiCardModal
        open={aiOpen}
        chapters={chapters}
        defaultChapterId={filterChapter !== "all" ? filterChapter : ""}
        onClose={() => setAiOpen(false)}
        onDone={async () => {
          setAiOpen(false);
          await load();
        }}
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
          <p className="text-sm text-neutral-100 line-clamp-2">{card.question}</p>
          <div className="flex items-center gap-2 text-[11px] text-neutral-500 mt-1">
            {card.chapter_number && (
              <span>
                {t("library.chaptersShort")} {String(card.chapter_number).padStart(2, "0")}
              </span>
            )}
            <span>·</span>
            <span>
              {card.source === "extracted"
                ? t("cards.source.extracted")
                : card.source === "ai_generated"
                ? t("cards.source.ai")
                : t("cards.source.manual")}
            </span>
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
            <div className="mt-3 pt-3 border-t border-border text-sm text-neutral-300 whitespace-pre-wrap space-y-2">
              {card.hint && (
                <p className="text-amber-400/90 text-xs italic">💡 {card.hint}</p>
              )}
              {card.answer ? (
                <p>{card.answer}</p>
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

function AiCardModal({
  open,
  chapters,
  defaultChapterId,
  onClose,
  onDone,
}: {
  open: boolean;
  chapters: Array<{ id: string; title: string; number: number }>;
  defaultChapterId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [chapterId, setChapterId] = useState("");
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [style, setStyle] = useState<Style>("deep");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setChapterId(defaultChapterId || chapters[0]?.id || "");
      setCount(5);
      setDifficulty("medium");
      setStyle("deep");
    }
  }, [open, defaultChapterId, chapters]);

  async function submit() {
    if (!chapterId) return;
    setBusy(true);
    try {
      const res = await api.cards.aiGenerate(chapterId, { count, difficulty, style });
      toast.show(
        t("cards.aiGenerated", { n: res.generated, model: res.model }),
        "success"
      );
      onDone();
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
      title={t("cards.ai.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !chapterId}>
            {busy ? t("cards.ai.submitting") : t("cards.ai.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-neutral-500">{t("cards.ai.description")}</p>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-400">
            {t("cards.field.chapter")}
          </label>
          <select
            className="input"
            value={chapterId}
            onChange={(e) => setChapterId(e.target.value)}
          >
            {chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {String(ch.number).padStart(2, "0")} ·{" "}
                {ch.title || `${t("learn.tab.chapters")} ${ch.number}`}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <label className="text-xs font-medium text-neutral-400">
              {t("cards.ai.count")}
            </label>
            <select
              className="input"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[3, 5, 8, 10, 15].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <label className="text-xs font-medium text-neutral-400">
              {t("cards.ai.difficulty")}
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
          <div className="flex flex-col gap-1 min-w-0">
            <label className="text-xs font-medium text-neutral-400">
              {t("cards.ai.style")}
            </label>
            <select
              className="input"
              value={style}
              onChange={(e) => setStyle(e.target.value as Style)}
            >
              <option value="basic">{t("cards.ai.style.basic")}</option>
              <option value="deep">{t("cards.ai.style.deep")}</option>
              <option value="exam">{t("cards.ai.style.exam")}</option>
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Re-exported because some callers may want the shared Input style.
void Input;
