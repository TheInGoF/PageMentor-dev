// Aussprache prüfen (Debug): Whisper hört ein fertiges Hörbuch ab, die App vergleicht mit dem Text.
// Je Befund: ▶ anhören, ✓ als gelöst abhaken, ⋯ in die Ausspracheliste übernehmen oder ignorieren
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";
import { useToast } from "../ui/Toast";
import { Card, Notice, SettingRow } from "./parts";

interface Doc {
  id: string;
  title: string;
  doc_title: string | null;
  open: number;
}
interface RunState {
  docId: string;
  running: boolean;
  waiting?: boolean;
  done: number;
  total: number;
  current?: string;
  found: number;
  error?: string;
}
interface Issue {
  id: string;
  chapter_id: string;
  chapter_title: string;
  chapter_number: number;
  kind: "different" | "missing" | "extra" | "unsure";
  expected: string;
  heard: string;
  start: number;
  end: number;
  prob: number;
  context: string;
  status: "open" | "resolved" | "ignored";
  note: string | null;
  // Was Gemma daraus gelernt hat: Hinweis, "-" = nichts Neues, null = noch nicht gefragt
  learned: string | null;
}
interface Chapter {
  id: string;
  number: number;
  title: string;
  hasAudio: boolean;
  checkedAt: number | null;
  open: number;
}

type Filter = "open" | "resolved" | "ignored";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Ausspracheliste geändert: andere Karten laden neu
export const PRON_CHANGED = "pm:pronunciation-changed";

export function PronCheckSection({ onEngines }: { onEngines: () => void }) {
  const toast = useToast();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docId, setDocId] = useState("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [state, setState] = useState<RunState | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [adding, setAdding] = useState<{ id: string; from: string; to: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const loadDocs = () =>
    request<{ available: boolean; docs: Doc[]; state: RunState | null }>("/api/pron-check/docs")
      .then((r) => {
        setAvailable(r.available);
        setDocs(r.docs);
        setState(r.state);
        setDocId((cur) => cur || r.state?.docId || r.docs[0]?.id || "");
      })
      .catch(() => setAvailable(false));
  const loadDoc = (id: string) =>
    id
      ? request<{ chapters: Chapter[]; issues: Issue[]; state: RunState | null }>(`/api/pron-check/doc/${id}`)
          .then((r) => {
            setChapters(r.chapters);
            setIssues(r.issues);
            setState(r.state);
          })
          .catch(() => undefined)
      : Promise.resolve();

  useEffect(() => {
    void loadDocs();
    return () => audio.current?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void loadDoc(docId);
  }, [docId]);
  const running = !!state?.running;
  // Nach dem grünen Haken fragt das Backend Gemma; so lange nachsehen, bis eine Antwort da ist
  const learning = issues.some((i) => i.status === "resolved" && !i.learned);
  useEffect(() => {
    if (!running && !learning) return;
    const iv = setInterval(() => void loadDoc(docId), 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, learning, docId]);

  async function run(chapterIds?: string[]) {
    try {
      setState(await request<RunState>(`/api/pron-check/doc/${docId}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chapterIds }) }));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    }
  }
  async function setStatus(id: string, status: Issue["status"], note?: string) {
    const r = await request<Issue>(`/api/pron-check/issue/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, note }) });
    setIssues((cur) => cur.map((i) => (i.id === id ? { ...i, status: r.status, note: r.note, learned: r.learned } : i)));
  }
  function play(id: string) {
    audio.current?.pause();
    audio.current = new Audio(`/api/pron-check/issue/${id}/audio`);
    void audio.current.play();
  }
  // In die Ausspracheliste: gleiches Wort ersetzen, sonst anhängen; danach gilt der Befund als gelöst
  async function addRule() {
    if (!adding || !adding.from.trim() || !adding.to.trim()) return;
    const cur = await api.pronunciation.get();
    const from = adding.from.trim();
    const entries = [...cur.entries.filter((e) => e.from.toLowerCase() !== from.toLowerCase()), { from, to: adding.to.trim() }];
    await api.pronunciation.save(entries);
    window.dispatchEvent(new Event(PRON_CHANGED));
    await setStatus(adding.id, "resolved", `${from} → ${adding.to.trim()}`);
    setAdding(null);
    toast.show(t("pronCheck.added"), "success");
  }
  async function suggest() {
    if (!adding) return;
    setSuggesting(true);
    try {
      const r = await api.pronunciation.suggest({ words: [adding.from.trim()] });
      const hit = r.items[0];
      if (hit) setAdding({ ...adding, to: hit.to });
    } finally {
      setSuggesting(false);
    }
  }

  if (available === null) return null;
  const shown = issues.filter((i) => i.status === filter);
  const counts = { open: 0, resolved: 0, ignored: 0 } as Record<Filter, number>;
  for (const i of issues) counts[i.status]++;
  const byChapter = new Map<string, Issue[]>();
  for (const i of shown) byChapter.set(i.chapter_id, [...(byChapter.get(i.chapter_id) ?? []), i]);
  const withAudio = chapters.filter((c) => c.hasAudio);

  return (
    <Card title={t("pronCheck.title")} status={t("pronCheck.debug")}>
      <p className="text-xs text-neutral-500">{t("pronCheck.hint")}</p>
      <p className="text-xs text-neutral-500">{t("pronCheck.learnHint")}</p>
      {!available ? (
        <Notice action={<Button variant="outline" onClick={onEngines}>{t("pronCheck.openEngines")}</Button>}>{t("pronCheck.notAvailable")}</Notice>
      ) : !docs.length ? (
        <Notice>{t("pronCheck.noDocs")}</Notice>
      ) : (
        <>
          <SettingRow label={t("pronCheck.doc")}>
            <select className="input w-full" value={docId} onChange={(e) => setDocId(e.target.value)} disabled={running}>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.doc_title || d.title}
                  {d.open ? ` · ${t("pronCheck.openCount", { n: d.open })}` : ""}
                </option>
              ))}
            </select>
          </SettingRow>

          {running && state?.docId === docId ? (
            <Notice action={<Button variant="ghost" onClick={() => void request("/api/pron-check/cancel", { method: "POST" }).then(() => loadDoc(docId))}>{t("common.cancel")}</Button>}>
              <div className="flex flex-col gap-2 w-full">
                <span>
                  {state.waiting
                    ? t("pronCheck.waiting")
                    : t("pronCheck.running", { done: Math.min(state.done + 1, state.total), total: state.total, current: state.current ?? "" })}
                </span>
                <div className="h-1.5 rounded bg-bg-elevated overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${(state.done / Math.max(1, state.total)) * 100}%` }} />
                </div>
              </div>
            </Notice>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void run()} disabled={!withAudio.length || running}>
                {t("pronCheck.runAll", { n: withAudio.length })}
              </Button>
              {state?.error && state.docId === docId && <span className="text-xs text-red-500">{state.error}</span>}
            </div>
          )}

          <div className="flex gap-2">
            {(["open", "resolved", "ignored"] as const).map((f) => (
              <button key={f} type="button" className={cn("chip", filter === f && "chip-active")} onClick={() => setFilter(f)}>
                {t(`pronCheck.filter.${f}`)} · {counts[f]}
              </button>
            ))}
          </div>

          {!shown.length ? (
            <p className="text-sm text-neutral-500">{t(chapters.some((c) => c.checkedAt) ? `pronCheck.empty.${filter}` : "pronCheck.notChecked")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {[...byChapter.entries()].map(([chId, list]) => (
                <div key={chId} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium flex-1 truncate">
                      {list[0].chapter_number}. {list[0].chapter_title}
                    </div>
                    {filter === "open" && (
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          await request(`/api/pron-check/chapter/${chId}/ignore`, { method: "POST" });
                          await loadDoc(docId);
                        }}
                      >
                        {t("pronCheck.ignoreRest")}
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => void run([chId])} disabled={running}>
                      {t("pronCheck.recheck")}
                    </Button>
                  </div>
                  <ul className="flex flex-col divide-y divide-border">
                    {list.map((i) => (
                      <li key={i.id} className="py-2 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-bg-elevated text-neutral-500 shrink-0 w-24 text-center">{t(`pronCheck.kind.${i.kind}`)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">
                              {i.kind === "extra" ? (
                                <>{t("pronCheck.extraWords", { heard: i.heard })}</>
                              ) : i.kind === "missing" ? (
                                <>{t("pronCheck.missingWords", { expected: i.expected })}</>
                              ) : (
                                <>
                                  „{i.expected}“ <span className="text-neutral-500">→ {t("pronCheck.heard")} „{i.heard}“</span>
                                </>
                              )}
                            </div>
                            <div className="text-xs text-neutral-500 truncate">
                              {mmss(i.start)} · {i.note ?? `… ${i.context} …`}
                              {i.kind !== "missing" && (i.kind === "unsure" || i.prob < 0.6) ? ` · ${t("pronCheck.prob", { p: Math.round(i.prob * 100) })}` : ""}
                            </div>
                          </div>
                          <button type="button" className="chip" onClick={() => play(i.id)} aria-label={t("pronCheck.play")}>
                            ▶
                          </button>
                          {i.status === "open" && (
                            <button
                              type="button"
                              className="w-10 h-10 rounded-md border border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 text-lg"
                              title={t("pronCheck.resolve")}
                              aria-label={t("pronCheck.resolve")}
                              onClick={() => void setStatus(i.id, "resolved")}
                            >
                              ✓
                            </button>
                          )}
                          <Menu
                            label={t("pronCheck.actions")}
                            items={[
                              ...(i.status === "open"
                                ? [
                                    { label: t("pronCheck.addRule"), onClick: () => setAdding({ id: i.id, from: (i.expected || i.heard).split(" ")[0], to: "" }), disabled: !i.expected && !i.heard },
                                    { label: t("pronCheck.ignore"), onClick: () => void setStatus(i.id, "ignored") },
                                  ]
                                : [{ label: t("pronCheck.reopen"), onClick: () => void setStatus(i.id, "open") }]),
                            ]}
                          />
                        </div>
                        {i.status === "resolved" && (
                          <div className={cn("text-xs pl-[104px]", i.learned && i.learned !== "-" ? "text-emerald-600" : "text-neutral-500")}>
                            {!i.learned ? t("pronCheck.learning") : i.learned === "-" ? t("pronCheck.learnedNothing") : t("pronCheck.learned", { rule: i.learned })}
                          </div>
                        )}
                        {adding?.id === i.id && (
                          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
                            <label className="flex flex-col gap-1 text-xs text-neutral-400 flex-1 min-w-[140px]">
                              {t("pronCheck.word")}
                              <input className="input" value={adding.from} onChange={(e) => setAdding({ ...adding, from: e.target.value })} />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-neutral-400 flex-1 min-w-[140px]">
                              {t("pronCheck.speakAs")}
                              <input className="input" value={adding.to} onChange={(e) => setAdding({ ...adding, to: e.target.value })} placeholder="Wörkflou" />
                            </label>
                            <Button variant="outline" onClick={() => void suggest()} disabled={suggesting || !adding.from.trim()} title={t("pronCheck.suggest")}>
                              ✨
                            </Button>
                            <Button onClick={() => void addRule()} disabled={!adding.from.trim() || !adding.to.trim()}>
                              {t("pronCheck.addAndResolve")}
                            </Button>
                            <Button variant="ghost" onClick={() => setAdding(null)}>
                              {t("common.cancel")}
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
