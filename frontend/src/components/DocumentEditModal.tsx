import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { api, type Document, type DocType } from "../lib/api";
import { useToast } from "./ui/Toast";
import { TagInput } from "./TagInput";
import { t } from "../lib/i18n";

interface Props {
  open: boolean;
  doc: Document | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPES: DocType[] = ["studienheft", "script", "klausur", "uebung", "sonstiges"];

export function DocumentEditModal({ open, doc, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocType>("studienheft");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open && doc) {
      setTitle(doc.title);
      setType(doc.type);
      setTags(doc.tags.join(", "));
      setBusy(false);
    }
  }, [open, doc]);

  async function submit() {
    if (!doc) return;
    setBusy(true);
    try {
      const tagList = tags
        .split(",")
        .map((s) => s.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean);
      await api.documents.patch(doc.id, {
        title: title.trim() || doc.title,
        type,
        tags: tagList,
      });
      onSaved();
      onClose();
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
      title={t("common.edit")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !doc}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </>
      }
    >
      {doc && (
        <div className="flex flex-col gap-4">
          <Input
            label={t("upload.title")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400">
              {t("upload.type")}
            </label>
            <select
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as DocType)}
            >
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`type.${ty}`)}
                </option>
              ))}
            </select>
          </div>
          <TagInput
            label={t("upload.tags")}
            value={tags}
            onChange={setTags}
            placeholder={t("upload.tagsPlaceholder")}
          />
          <p className="text-[11px] text-neutral-500">
            <span className="font-mono">{doc.filename}</span>
            {doc.page_count > 0 && ` · ${doc.page_count} ${t("library.pagesShort")}`}
          </p>
        </div>
      )}
    </Modal>
  );
}
