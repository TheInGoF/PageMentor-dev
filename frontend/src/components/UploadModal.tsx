import { useRef, useState, useEffect, type FormEvent } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { TagInput } from "./TagInput";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import type { DocType, ModuleListItem } from "../lib/api";
import { getSettings } from "../lib/settings";

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

const TYPES: DocType[] = ["studienheft", "script", "klausur", "uebung", "sonstiges"];
const LANGS = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
];

export function UploadModal({ open, onClose, onUploaded }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [type, setType] = useState<DocType>("studienheft");
  const [language, setLanguage] = useState("de");
  const [moduleId, setModuleId] = useState("");
  const [modules, setModules] = useState<ModuleListItem[]>([]);
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dropRef = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    if (open) {
      setLanguage(getSettings().defaultLanguage);
      // Module-Liste lazy laden — alle Modals tun das so. Wenn der
      // Endpoint fehlschlägt bleibt das Dropdown leer ("ohne Modul"),
      // der Upload geht trotzdem durch.
      api.modules
        .list()
        .then(setModules)
        .catch(() => setModules([]));
    }
  }, [open]);

  function reset() {
    setFiles([]);
    setType("studienheft");
    setLanguage(getSettings().defaultLanguage);
    setModuleId("");
    setTags("");
    setBusy(false);
    setProgress(null);
    setError(null);
  }

  function addFiles(next: File[]) {
    const pdfs = next.filter((f) => f.type.includes("pdf") || /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) return;
    setFiles((cur) => {
      const existing = new Set(cur.map((f) => `${f.name}:${f.size}`));
      return [
        ...cur,
        ...pdfs.filter((f) => !existing.has(`${f.name}:${f.size}`)),
      ];
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setProgress({ current: 0, total: files.length });
    let uploaded = 0;
    const failures: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.set("file", file);
      form.set("type", type);
      form.set("language", language);
      form.set("tags", tags);
      if (moduleId) form.set("module", moduleId);
      try {
        await api.documents.upload(form);
        uploaded++;
        setProgress({ current: uploaded, total: files.length });
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : "Fehler"}`);
      }
    }
    onUploaded();
    if (failures.length === 0) {
      reset();
      onClose();
    } else {
      setError(failures.join("\n"));
      setBusy(false);
      setFiles(files.filter((f) => failures.some((m) => m.startsWith(f.name + ":"))));
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
      title={t("upload.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit as any} disabled={busy || files.length === 0}>
            {busy
              ? progress
                ? t("upload.uploadingProgress", {
                    current: progress.current,
                    total: progress.total,
                  })
                : t("upload.uploading")
              : files.length > 1
              ? t("upload.submitMany", { n: files.length })
              : t("upload.submit")}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label
          ref={dropRef}
          htmlFor="pm-file"
          onDragOver={(e) => {
            e.preventDefault();
            dropRef.current?.classList.add("border-accent");
          }}
          onDragLeave={() => dropRef.current?.classList.remove("border-accent")}
          onDrop={(e) => {
            e.preventDefault();
            dropRef.current?.classList.remove("border-accent");
            addFiles(Array.from(e.dataTransfer.files));
          }}
          className="cursor-pointer border-2 border-dashed border-border rounded-lg px-4 py-6 text-center text-sm text-neutral-400 hover:border-border-strong transition-colors"
        >
          {files.length > 0 ? (
            <ul className="text-left flex flex-col gap-1 max-h-40 overflow-y-auto">
              {files.map((f, i) => (
                <li key={`${f.name}:${f.size}`} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    <strong className="text-neutral-100">{f.name}</strong>{" "}
                    <span className="text-neutral-500">
                      ({(f.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setFiles(files.filter((_, j) => j !== i));
                    }}
                    className="text-xs text-neutral-500 hover:text-accent"
                    aria-label={t("upload.remove")}
                    title={t("upload.remove")}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            t("upload.dropHere")
          )}
          <input
            id="pm-file"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-400">{t("upload.type")}</label>
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
            <label className="text-xs font-medium text-neutral-400">{t("upload.language")}</label>
            <select
              className="input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-neutral-400">{t("upload.module")}</label>
          <select
            className="input"
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
          >
            <option value="">{t("upload.moduleNone")}</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.icon ? `${m.icon} ${m.name}` : m.name}
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

        {error && <p className="text-xs text-accent">{error}</p>}
      </form>
    </Modal>
  );
}
