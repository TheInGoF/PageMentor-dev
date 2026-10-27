import { useEffect, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { api, type Document as Doc, type DocType, type ModuleListItem } from "../lib/api";
import { useToast } from "./ui/Toast";
import { TagInput } from "./TagInput";
import { t } from "../lib/i18n";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface Props {
  open: boolean;
  doc: Doc | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPES: DocType[] = ["studienheft", "script", "klausur", "uebung", "sonstiges"];

export function DocumentEditModal({ open, doc, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [seriesSequence, setSeriesSequence] = useState("");
  const [type, setType] = useState<DocType>("studienheft");
  const [tags, setTags] = useState("");
  const [moduleId, setModuleId] = useState<string>("");
  const [modules, setModules] = useState<ModuleListItem[]>([]);
  const [thumbPage, setThumbPage] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open && doc) {
      setTitle(doc.title);
      setAuthor(doc.author ?? "");
      setShortCode(doc.short_code ?? "");
      setSeriesSequence(doc.series_sequence ?? "");
      setType(doc.type);
      setTags(doc.tags.join(", "));
      setModuleId(doc.module_id ?? "");
      setThumbPage(doc.thumb_page && doc.thumb_page > 0 ? doc.thumb_page : 1);
      setBusy(false);
      api.modules.list().then(setModules).catch(() => setModules([]));
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
        module_id: moduleId || null,
        thumb_page: thumbPage,
        author: author.trim() ? author.trim() : null,
        short_code: shortCode.trim() ? shortCode.trim() : null,
        series_sequence: seriesSequence.trim() ? seriesSequence.trim() : null,
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
      size="3xl"
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
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-5">
          <div className="flex flex-col gap-4 min-w-0">
            <Input
              label={t("upload.title")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
              <Input
                label={t("doc.field.author")}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder={t("doc.field.authorPlaceholder")}
              />
              <Input
                label={t("doc.field.shortCode")}
                value={shortCode}
                onChange={(e) => setShortCode(e.target.value)}
                placeholder={t("doc.field.shortCodePlaceholder")}
                className="sm:w-28"
              />
              <Input
                label={t("doc.field.seriesSequence")}
                value={seriesSequence}
                onChange={(e) => setSeriesSequence(e.target.value)}
                placeholder={t("doc.field.seriesSequencePlaceholder")}
                className="sm:w-20"
              />
            </div>
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
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("doc.field.module")}
              </label>
              <select
                className="input"
                value={moduleId}
                onChange={(e) => setModuleId(e.target.value)}
              >
                <option value="">{t("doc.field.module.none")}</option>
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.icon} {m.name}
                    {m.semester ? ` · ${m.semester}` : ""}
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
            <p className="text-xs text-neutral-500">
              <span className="font-mono">{doc.filename}</span>
              {doc.page_count > 0 && ` · ${doc.page_count} ${t("library.pagesShort")}`}
            </p>
          </div>

          <div className="flex flex-col gap-1 min-w-0">
            <label className="text-xs font-medium text-neutral-400">
              {t("doc.field.preview")}
            </label>
            <MiniPdfPreview
              docId={doc.id}
              page={thumbPage}
              onPageChange={setThumbPage}
            />
            <p className="text-xs text-neutral-500 mt-1">
              {t("doc.preview.thumbHint")}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function MiniPdfPreview({
  docId,
  page,
  onPageChange,
}: {
  docId: string;
  page: number;
  onPageChange: (p: number) => void;
}) {
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState(false);
  const fileUrl = `/api/documents/${docId}/pdf`;

  useEffect(() => {
    setNumPages(0);
    setError(false);
  }, [docId]);

  const safePage = Math.max(1, numPages > 0 ? Math.min(numPages, page) : page);

  return (
    <div className="card bg-bg-elevated p-2 flex flex-col items-center gap-2">
      <div className="w-full max-h-[50vh] overflow-auto flex justify-center">
        {error ? (
          <div className="text-xs text-accent py-6">{t("doc.preview.error")}</div>
        ) : (
          <Document
            file={fileUrl}
            loading={
              <div className="text-xs text-neutral-500 py-6">
                {t("doc.preview.loading")}
              </div>
            }
            error={
              <div className="text-xs text-accent py-6">{t("doc.preview.error")}</div>
            }
            onLoadSuccess={({ numPages }) => {
              setNumPages(numPages);
              setError(false);
            }}
            onLoadError={() => setError(true)}
          >
            <Page
              pageNumber={safePage}
              width={270}
              renderTextLayer
              renderAnnotationLayer={false}
            />
          </Document>
        )}
      </div>
      {numPages > 0 && !error && (
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <button
            type="button"
            className="btn-ghost !px-2 !py-1"
            onClick={() => onPageChange(Math.max(1, safePage - 1))}
            disabled={safePage <= 1}
            aria-label={t("doc.preview.prev")}
          >
            ←
          </button>
          <span className="font-mono">
            {t("doc.preview.page", { page: safePage, total: numPages })}
          </span>
          <button
            type="button"
            className="btn-ghost !px-2 !py-1"
            onClick={() => onPageChange(Math.min(numPages, safePage + 1))}
            disabled={safePage >= numPages}
            aria-label={t("doc.preview.next")}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
