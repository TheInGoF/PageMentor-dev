import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { t } from "../lib/i18n";

const ACCEPTED_KEY = "pagementor.ttsNoticeAccepted.v1";

export function hasAcceptedTtsNotice(): boolean {
  try {
    return localStorage.getItem(ACCEPTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTtsNoticeAccepted(): void {
  try {
    localStorage.setItem(ACCEPTED_KEY, "1");
  } catch {
    // storage disabled — user will be asked again next session
  }
}

interface Props {
  open: boolean;
  onAccept: (remember: boolean) => void;
  onCancel: () => void;
}

export function TtsNoticeModal({ open, onAccept, onCancel }: Props) {
  const [remember, setRemember] = useState(true);
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t("tts.notice.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t("tts.notice.cancel")}
          </Button>
          <Button onClick={() => onAccept(remember)}>{t("tts.notice.accept")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>{t("tts.notice.body")}</p>
        <p className="text-xs text-neutral-500">{t("tts.notice.alternative")}</p>
        <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="accent-accent"
          />
          {t("tts.notice.rememberLabel")}
        </label>
      </div>
    </Modal>
  );
}
