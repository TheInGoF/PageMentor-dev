// Begriffsnetz eines Moduls: Fachbegriffe mit Erklärung, wo sie erklärt werden und worauf sie aufbauen.
// Gemma erfasst die Begriffe einmal je Kapitel im Hintergrund; der Tutor nutzt sie bis zur dritten Ebene
import { useEffect, useMemo, useState } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { getSettings } from "../../lib/settings";
import { Button } from "../ui/Button";
import { Notice } from "../settings/parts";

interface Place { chapterId: string; chapter: string; page: number; docId: string; doc: string; explains: boolean }
interface Concept { id: string; name: string; definition: string | null; places: Place[]; needs: Array<{ id: string; name: string }>; neededBy: Array<{ id: string; name: string }> }
interface Status { running: boolean; done: number; total: number; current?: string; open: number }

export function ConceptList({ moduleId, moduleName, onOpenDocument }: { moduleId: string; moduleName: string; onOpenDocument: (id: string) => void }) {
  const [concepts, setConcepts] = useState<Concept[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);

  const load = () => void request<{ concepts: Concept[] }>(`/api/concepts/module/${moduleId}`).then((r) => setConcepts(r.concepts));
  const poll = () => request<Status>(`/api/concepts/status?moduleId=${moduleId}`).then(setStatus);
  useEffect(() => {
    load();
    void poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);
  const running = !!status?.running;
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      void poll();
      load();
    }, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (concepts ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || (c.definition ?? "").toLowerCase().includes(q));
  }, [concepts, filter]);

  async function start() {
    setStatus(await request<Status>("/api/concepts/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moduleId, model: getSettings().defaultOllamaModel || undefined }) }).then((s) => ({ ...s, open: status?.open ?? 0 })));
  }
  async function copy() {
    const data = { module: moduleName, exportedAt: new Date().toISOString(), concepts: (concepts ?? []).map((c) => ({ name: c.name, definition: c.definition, needs: c.needs.map((n) => n.name), neededBy: c.neededBy.map((n) => n.name), places: c.places.map((p) => `${p.doc} · ${p.chapter} (S. ${p.page})${p.explains ? "" : " [benutzt]"}`) })) };
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-4">
      {running ? (
        <Notice>{t("concepts.running", { done: status!.done, total: status!.total, current: status!.current ?? "" })}</Notice>
      ) : status && status.open > 0 ? (
        <Notice action={<Button variant="outline" onClick={start}>{t("concepts.start")}</Button>}>{t("concepts.open", { n: status.open })}</Notice>
      ) : null}
      {concepts && concepts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1 min-w-[12rem]" placeholder={t("concepts.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Button variant="ghost" onClick={copy}>{copied ? t("graph.copied") : t("concepts.copy")}</Button>
        </div>
      )}
      {concepts && !concepts.length && !running && <p className="text-sm text-neutral-500">{t("concepts.empty")}</p>}
      <ul className="flex flex-col divide-y divide-border">
        {shown.map((c) => (
          <li key={c.id} className="py-2 flex flex-col gap-1">
            <div className="text-sm font-semibold">{c.name}</div>
            {c.definition && <div className="text-sm text-neutral-300">{c.definition}</div>}
            {c.needs.length > 0 && <div className="text-xs text-neutral-500">{t("concepts.needs")}: {c.needs.map((n) => n.name).join(", ")}</div>}
            {c.neededBy.length > 0 && <div className="text-xs text-neutral-500">{t("concepts.neededBy")}: {c.neededBy.map((n) => n.name).join(", ")}</div>}
            <div className="flex flex-wrap gap-2 pt-1">
              {c.places.map((p) => (
                <button key={p.chapterId} type="button" className="chip" title={t(p.explains ? "concepts.explains" : "concepts.uses")} onClick={() => onOpenDocument(p.docId)}>
                  {p.explains ? "★ " : ""}{p.doc} · {p.chapter} · S. {p.page}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
