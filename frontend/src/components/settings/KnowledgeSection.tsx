// Wissensdatenbank: Zustand der Suche vorn; Prüffragen mit bekannter Fundstelle als Expertenteil
import { useEffect, useState } from "react";
import { api, type Document, type EvalQuestion, type EvalReport } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import type { SettingsState } from "./state";
import { Card, Expert, Notice, SettingRow } from "./parts";

export function KnowledgeSection({ st }: { st: SettingsState }) {
  const { ollama, ragStatus, reembedAll, reembedBusy } = st;
  const [vector, setVector] = useState<{ available: boolean; error: string | null } | null>(null);
  useEffect(() => {
    void api.rag.status().then((s) => setVector(s.vector ?? null)).catch(() => undefined);
  }, []);

  return (
    <Card
      title={t("knowledge.title")}
      status={ragStatus ? t("knowledge.count", { embedded: ragStatus.embedded, total: ragStatus.total, docs: ragStatus.documents }) : undefined}
    >
      {vector && !vector.available && <Notice kind="warn">{t("knowledge.vecMissing", { error: vector.error ?? "?" })}</Notice>}
      <SettingRow label={t("settings.embed.reembed")} hint={t("knowledge.reembedHint")}>
        <Button variant="outline" className="w-full" onClick={reembedAll} disabled={reembedBusy || !ollama?.available}>
          {reembedBusy ? t("settings.embed.reembedBusy") : t("knowledge.reembedShort")}
        </Button>
      </SettingRow>
    </Card>
  );
}

export function KnowledgeEval() {
  const [questions, setQuestions] = useState<EvalQuestion[]>([]);
  const [docs, setDocs] = useState<Document[]>([]);
  const [form, setForm] = useState({ question: "", doc: "", page: "" });
  const [report, setReport] = useState<EvalReport | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => setQuestions((await api.knowledge.evalList()).questions);
  useEffect(() => {
    void load().catch(() => undefined);
    void api.documents.list().then((d) => setDocs(d.filter((x) => x.ocr_status === "done")));
  }, []);

  async function add() {
    try {
      await api.knowledge.evalAdd({ question: form.question, expected_document_id: form.doc, expected_page: form.page ? Number(form.page) : null, module_id: null });
      setForm({ question: "", doc: form.doc, page: "" });
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }

  async function run() {
    setBusy(true);
    try {
      setReport(await api.knowledge.evalRun());
    } finally {
      setBusy(false);
    }
  }

  const rank = (id: string) => report?.results.find((r) => r.id === id)?.rank;
  return (
    <Expert title={t("knowledge.evalTitle")}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-neutral-500">{t("knowledge.evalHint")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_14rem_5rem_auto] gap-2">
          <input className="input" placeholder={t("knowledge.question")} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
          <select className="input" value={form.doc} onChange={(e) => setForm({ ...form, doc: e.target.value })}>
            <option value="">{t("knowledge.expectedDoc")}</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <input className="input" placeholder={t("knowledge.page")} inputMode="numeric" value={form.page} onChange={(e) => setForm({ ...form, page: e.target.value.replace(/\D/g, "") })} />
          <Button variant="outline" onClick={add} disabled={!form.question.trim() || !form.doc}>
            +
          </Button>
        </div>
        {questions.length > 0 && (
          <ul className="text-sm divide-y divide-border">
            {questions.map((q) => (
              <li key={q.id} className="py-2 flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate">{q.question}</span>
                <span className="text-xs text-neutral-500 truncate max-w-[12rem]">
                  {q.doc_title}
                  {q.expected_page ? `, S. ${q.expected_page}` : ""}
                </span>
                {report && <span className={`text-xs w-14 text-right ${rank(q.id) ? "text-green-600" : "text-red-600"}`}>{rank(q.id) ? `#${rank(q.id)}` : "–"}</span>}
                <button type="button" className="text-xs text-neutral-500 hover:text-red-600" onClick={async () => (await api.knowledge.evalDelete(q.id), load())}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-4">
          <Button onClick={run} disabled={busy || !questions.length}>
            {busy ? t("knowledge.running") : t("knowledge.run")}
          </Button>
          {report && <span className="text-sm">{t("knowledge.result", { recall: Math.round(report.recall * 100), k: report.k, mrr: report.mrr.toFixed(2), mode: report.mode })}</span>}
        </div>
      </div>
    </Expert>
  );
}
