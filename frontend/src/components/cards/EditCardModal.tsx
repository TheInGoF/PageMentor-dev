// Karte bearbeiten oder anlegen
import { useEffect, useState } from "react";
import {
  api,
  type Card,
} from "../../lib/api";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { t } from "../../lib/i18n";
import type { Difficulty } from "../Cards";

export function EditCardModal({
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
