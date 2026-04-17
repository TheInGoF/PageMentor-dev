import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { api } from "../lib/api";
import { useToast } from "./ui/Toast";
import { t } from "../lib/i18n";

interface Props {
  open: boolean;
  docId: string;
  onClose: () => void;
}

export function PodcastShareModal({ open, docId, onClose }: Props) {
  const [feedUrl, setFeedUrl] = useState("");
  const [m4bUrl, setM4bUrl] = useState("");
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    api.feed
      .urls(docId)
      .then((r) => {
        setFeedUrl(r.feedUrl);
        setM4bUrl(r.m4bUrl);
      })
      .catch((err) => toast.show(err instanceof Error ? err.message : t("common.error"), "error"));
  }, [open, docId, toast]);

  async function copy(url: string, successKey: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.show(t(successKey), "success");
    } catch {
      toast.show(t("podcast.clipboardFail"), "error");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("podcast.title")}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 text-sm">
        <section>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">📚</span>
            <h3 className="font-medium">{t("podcast.books")}</h3>
          </div>
          <p className="text-xs text-neutral-500 mb-2">
            {t("podcast.books.description")}
          </p>
          <div className="flex items-center gap-2">
            <a href={m4bUrl} download className="btn-primary flex-1 text-center">
              {t("podcast.books.download")}
            </a>
            <Button variant="outline" onClick={() => copy(m4bUrl, "podcast.books.urlCopied")}>
              {t("podcast.books.copyUrl")}
            </Button>
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🎙</span>
            <h3 className="font-medium">{t("podcast.pc.title")}</h3>
          </div>
          <p className="text-xs text-neutral-500 mb-2">
            {t("podcast.pc.description")}
          </p>
          <div className="flex flex-col gap-2">
            <code className="text-[11px] bg-bg-elevated border border-border rounded p-2 break-all">
              {feedUrl || "…"}
            </code>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => copy(feedUrl, "podcast.pc.urlCopied")}
                className="flex-1"
                disabled={!feedUrl}
              >
                {t("podcast.pc.copy")}
              </Button>
              <a
                href={feedUrl ? `podcast://${feedUrl.replace(/^https?:\/\//, "")}` : "#"}
                className="btn-outline"
                title={t("podcast.pc.openTitle")}
              >
                {t("podcast.pc.open")}
              </a>
            </div>
            <p className="text-[11px] text-neutral-500">{t("podcast.pc.note")}</p>
          </div>
        </section>
      </div>
    </Modal>
  );
}
