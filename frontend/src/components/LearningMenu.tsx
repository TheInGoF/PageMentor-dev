import { useEffect, useState } from "react";
import { api, type Chapter, type Document } from "../lib/api";
import { t, useLocale } from "../lib/i18n";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { Audiobook } from "./Audiobook";
import { PdfViewer } from "./PdfViewer";
import { Cards } from "./Cards";
import { ExamTrainer } from "./ExamTrainer";
import { Summaries } from "./Summaries";

type Tab = "reader" | "chapters" | "audiobook" | "exercises" | "exam" | "summary";

const TABS: Array<{ id: Tab; labelKey: string }> = [
  { id: "reader", labelKey: "learn.tab.reader" },
  { id: "chapters", labelKey: "learn.tab.chapters" },
  { id: "audiobook", labelKey: "learn.tab.audiobook" },
  { id: "exercises", labelKey: "learn.tab.exercises" },
  { id: "exam", labelKey: "learn.tab.exam" },
  { id: "summary", labelKey: "learn.tab.summary" },
];

interface Props {
  docId: string;
  onBack: () => void;
}

export function LearningMenu({ docId, onBack }: Props) {
  const [doc, setDoc] = useState<Document | null>(null);
  const [tab, setTab] = useState<Tab>("reader");
  const toast = useToast();
  useLocale();

  useEffect(() => {
    api.documents
      .get(docId)
      .then(setDoc)
      .catch((err) =>
        toast.show(err instanceof Error ? err.message : t("common.error"), "error")
      );
  }, [docId, toast]);

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-black/90 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-4">
          <Button variant="ghost" onClick={onBack} className="!px-2">
            ← {t("learn.back")}
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold truncate">{doc?.title ?? "…"}</h1>
            {doc && (
              <p className="text-xs text-neutral-500">
                {t(`type.${doc.type}`)}
                {doc.page_count > 0 && ` · ${doc.page_count} ${t("library.pagesShort")}`}
                {` · ${t(`ocr.${doc.ocr_status}`)}`}
              </p>
            )}
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={
                "px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap " +
                (tab === tb.id
                  ? "border-accent text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-200")
              }
            >
              {t(tb.labelKey)}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        {tab === "reader" && <PdfViewer docId={docId} />}
        {tab === "chapters" && <ChaptersTab docId={docId} docStatus={doc?.ocr_status} />}
        {tab === "audiobook" &&
          (doc ? (
            <Audiobook docId={docId} documentLanguage={doc.language} />
          ) : (
            <div className="card p-6 text-sm text-neutral-500">{t("common.loading")}</div>
          ))}
        {tab === "exercises" && <Cards docId={docId} />}
        {tab === "exam" && <ExamTrainer docId={docId} />}
        {tab === "summary" && <Summaries docId={docId} />}
      </main>
    </div>
  );
}

function ChaptersTab({
  docId,
  docStatus,
}: {
  docId: string;
  docStatus: Document["ocr_status"] | undefined;
}) {
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const toast = useToast();

  async function load() {
    try {
      setChapters(await api.chapters.list(docId));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  useEffect(() => {
    if (docStatus === "running" || docStatus === "pending") {
      const iv = setInterval(load, 3000);
      return () => clearInterval(iv);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docStatus]);

  async function redetect() {
    if (!confirm(t("chapters.detectConfirm"))) return;
    setBusy(true);
    try {
      const res = await api.chapters.detect(docId);
      toast.show(t("chapters.detectedToast", { n: res.chapters }), "success");
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle(id: string) {
    try {
      await api.chapters.patch(id, { title: editTitle.trim() });
      setEditing(null);
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function mergeSelected() {
    if (selected.size < 2 || !chapters) return;
    const inOrder = chapters.filter((c) => selected.has(c.id)).map((c) => c.id);
    setBusy(true);
    try {
      await api.chapters.merge(inOrder);
      toast.show(t("chapters.merged", { n: inOrder.length }), "success");
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteChapter(ch: Chapter) {
    if (
      !confirm(
        t("chapters.deleteConfirm", {
          title: ch.title || `${t("learn.tab.chapters")} ${ch.number}`,
        })
      )
    )
      return;
    try {
      await api.chapters.remove(ch.id);
      setSelected((s) => {
        const next = new Set(s);
        next.delete(ch.id);
        return next;
      });
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">{t("chapters.title")}</h2>
        <div className="flex gap-2">
          {selected.size >= 2 && (
            <Button variant="outline" onClick={mergeSelected} disabled={busy}>
              {t("chapters.merge", { n: selected.size })}
            </Button>
          )}
          <Button variant="outline" onClick={redetect} disabled={busy}>
            {busy ? t("common.loading") : t("chapters.detect")}
          </Button>
        </div>
      </div>

      {!chapters ? (
        <p className="text-sm text-neutral-500">{t("common.loading")}</p>
      ) : chapters.length === 0 ? (
        <div className="card p-8 text-center text-sm text-neutral-500">
          {t("chapters.empty")}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {chapters.map((ch) => (
            <li key={ch.id} className="card card-hover p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(ch.id)}
                  onChange={() => toggleSelect(ch.id)}
                  className="mt-1 accent-accent"
                />
                <div className="text-accent font-mono text-sm min-w-[2ch] text-right pt-0.5">
                  {String(ch.number).padStart(2, "0")}
                </div>
                <div className="flex-1 min-w-0">
                  {editing === ch.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveTitle(ch.id);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        className="input !py-1"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                      <Button
                        className="!py-1 !px-2 text-xs"
                        onClick={() => saveTitle(ch.id)}
                        aria-label={t("common.save")}
                      >
                        ✓
                      </Button>
                      <Button
                        variant="ghost"
                        className="!py-1 !px-2 text-xs"
                        onClick={() => setEditing(null)}
                        aria-label={t("common.cancel")}
                      >
                        ✕
                      </Button>
                    </form>
                  ) : (
                    <h3
                      className="font-medium text-neutral-100 truncate cursor-text hover:text-accent"
                      onClick={() => {
                        setEditing(ch.id);
                        setEditTitle(ch.title || "");
                      }}
                      title={t("library.editHint")}
                    >
                      {ch.title || `${t("learn.tab.chapters")} ${ch.number}`}
                    </h3>
                  )}
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {t("chapters.pages")} {ch.start_page}
                    {ch.end_page !== ch.start_page ? `–${ch.end_page}` : ""}
                    {ch.text &&
                      ` · ${t("chapters.chars", { n: ch.text.length.toLocaleString() })}`}
                  </p>
                </div>
                <button
                  onClick={() => deleteChapter(ch)}
                  className="text-neutral-500 hover:text-accent text-xs"
                  title={t("common.delete")}
                  aria-label={t("common.delete")}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

