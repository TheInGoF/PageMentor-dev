// Gehirn: das globale Begriffsnetz, über alle Module. Punkte sind Begriffe (Größe = Fundstellen, Farbe = Modul),
// Linien „baut auf“. Eine Frage lässt die Begriffe aufleuchten, die der Tutor dafür nutzen würde, mit Ebenen 1–3
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { DARK, LIGHT } from "../module/GraphPanel";
import { brainLayout } from "./layout";

interface BrainNode { id: string; name: string; mentions: number; moduleId: string | null; modules: number; explained: boolean }
interface BrainEdge { a: string; b: string; weight: number }
interface Graph { nodes: BrainNode[]; edges: BrainEdge[]; modules: Array<{ id: string; name: string; icon: string | null }>; total: { concepts: number; links: number } }
interface Active { id: string; name: string; depth: number; strength: number; via?: string }
interface Detail {
  id: string;
  name: string;
  definition: string | null;
  places: Array<{ chapter: string; page: number; docId: string; doc: string; module: string | null; explains: boolean }>;
  needs: Array<{ id: string; name: string }>;
  neededBy: Array<{ id: string; name: string }>;
}

const W = 1000;
const H = 640;
const SIZES = [80, 150, 300];
const LABELS = 30;

export function BrainView({ onOpenSource }: { onOpenSource: (docId: string, page: number) => void }) {
  const [moduleId, setModuleId] = useState("");
  const [limit, setLimit] = useState(150);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [question, setQuestion] = useState("");
  const [active, setActive] = useState<Active[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [noEmbeddings, setNoEmbeddings] = useState(false);

  useEffect(() => {
    setActive(null);
    void request<Graph>(`/api/concepts/brain?limit=${limit}${moduleId ? `&moduleId=${moduleId}` : ""}`).then(setGraph).catch(() => undefined);
  }, [moduleId, limit]);
  useEffect(() => {
    if (!selected) return setDetail(null);
    void request<Detail>(`/api/concepts/${selected}`).then(setDetail).catch(() => setDetail(null));
  }, [selected]);
  const pos = useMemo(() => (graph ? brainLayout(graph.nodes.map((n) => n.id), graph.edges, W, H) : null), [graph]);

  if (!graph || !pos) return <div className="text-sm text-neutral-500">{t("common.loading")}</div>;
  if (!graph.total.concepts)
    return <div className="card p-8 text-center text-sm text-neutral-500">{t("brain.empty")}</div>;

  const dark = document.documentElement.dataset.theme === "dark";
  const modIdx = new Map(graph.modules.map((m, i) => [m.id, i]));
  const color = (id: string | null) => {
    const i = id ? modIdx.get(id) ?? 99 : 99;
    return i < 8 ? (dark ? DARK : LIGHT)[i] : "#9a9a9a";
  };
  const activeById = new Map((active ?? []).map((a) => [a.id, a]));
  const focus = hover ?? selected;
  const near = new Set(graph.edges.filter((e) => e.a === focus || e.b === focus).flatMap((e) => [e.a, e.b]));
  const top = new Set([...graph.nodes].sort((a, b) => b.mentions - a.mentions).slice(0, LABELS).map((n) => n.id));
  const radius = (n: BrainNode) => Math.min(14, 3 + Math.sqrt(n.mentions) * 2);
  const dim = (id: string) => (active ? !activeById.has(id) : focus ? !near.has(id) && id !== focus : false);
  const shownModules = graph.modules.filter((m) => graph.nodes.some((n) => n.moduleId === m.id));

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || !graph) return;
    setBusy(true);
    try {
      const r = await request<{ active: Active[]; nodes: BrainNode[]; edges: BrainEdge[]; embeddings: boolean }>("/api/concepts/brain/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, have: graph.nodes.map((n) => n.id) }),
      });
      setNoEmbeddings(!r.embeddings);
      if (r.nodes.length) setGraph({ ...graph, nodes: [...graph.nodes, ...r.nodes], edges: [...graph.edges, ...r.edges] });
      setActive(r.active);
      setSelected(r.active[0]?.id ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="card p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select className="input flex-1 min-w-[180px]" value={moduleId} onChange={(e) => setModuleId(e.target.value)} aria-label={t("brain.scope")}>
              <option value="">{t("tutor.allModules")}</option>
              {graph.modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.icon ? `${m.icon} ${m.name}` : m.name}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              {SIZES.map((s) => (
                <button key={s} type="button" className={cn("chip", limit === s && "chip-active")} onClick={() => setLimit(s)}>
                  {t("brain.size", { n: s })}
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={ask} className="flex gap-2">
            <input className="input flex-1" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("brain.askPlaceholder")} />
            <Button type="submit" disabled={busy || !question.trim()}>
              {t("brain.activate")}
            </Button>
            {active && (
              <Button type="button" variant="ghost" onClick={() => setActive(null)}>
                {t("brain.reset")}
              </Button>
            )}
          </form>
          <p className="text-xs text-neutral-500">
            {t("brain.stats", { shown: graph.nodes.length, total: graph.total.concepts, links: graph.total.links })}
            {noEmbeddings && ` · ${t("brain.noEmbeddings")}`}
          </p>
        </div>

        <div className="card p-2 overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px] h-auto" role="img" aria-label={t("brain.title")} onClick={() => setSelected(null)}>
            <defs>
              <marker id="brain-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {graph.edges.map((e, i) => {
              const pa = pos.get(e.a), pb = pos.get(e.b);
              if (!pa || !pb) return null;
              const lit = active ? activeById.has(e.a) && activeById.has(e.b) : focus ? e.a === focus || e.b === focus : false;
              return (
                <line
                  key={i}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  className={lit ? "text-accent" : "text-neutral-500"}
                  stroke="currentColor"
                  strokeOpacity={lit ? 0.9 : active || focus ? 0.08 : 0.25}
                  strokeWidth={lit ? 1.6 : 0.8}
                  markerEnd={lit ? "url(#brain-arrow)" : undefined}
                />
              );
            })}
            {graph.nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const a = activeById.get(n.id);
              const r = radius(n);
              return (
                <g
                  key={n.id}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(n.id);
                  }}
                  opacity={dim(n.id) ? 0.15 : a ? Math.max(0.45, a.strength > 1 ? 1 : a.strength + 0.3) : 1}
                >
                  {/* Große Trefferfläche, auch für kleine Punkte */}
                  <circle cx={p.x} cy={p.y} r={Math.max(r, 10)} fill="transparent" />
                  <circle cx={p.x} cy={p.y} r={r} fill={color(n.moduleId)} stroke={selected === n.id || a?.depth === 0 ? "currentColor" : "none"} strokeWidth={2} />
                  {n.modules > 1 && <circle cx={p.x} cy={p.y} r={r + 3} fill="none" stroke={color(n.moduleId)} strokeOpacity={0.6} strokeDasharray="2 2" />}
                  {(top.has(n.id) || a || near.has(n.id) || selected === n.id) && (
                    <text x={p.x} y={p.y - r - 4} textAnchor="middle" className="fill-current text-[11px]" style={{ paintOrder: "stroke", stroke: "rgb(var(--bg, 255 255 255))", strokeWidth: 3 }}>
                      {a && a.depth > 0 ? `${n.name} · ${a.depth}` : n.name}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-neutral-500">
          {shownModules.map((m) => (
            <span key={m.id} className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: color(m.id) }} />
              {m.name}
            </span>
          ))}
          <span>{t("brain.legend")}</span>
        </div>
      </div>

      <aside className="card p-4 flex flex-col gap-3 h-fit">
        {active && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{t("brain.activeTitle")}</h3>
            {active.length === 0 && <p className="text-xs text-neutral-500">{t("brain.nothingActive")}</p>}
            {active.map((a) => (
              <button
                key={a.id}
                type="button"
                className={cn("text-left text-sm rounded pr-2 py-1 hover:bg-neutral-900", selected === a.id && "bg-neutral-900")}
                style={{ paddingLeft: 8 + a.depth * 14 }}
                onClick={() => setSelected(a.id)}
              >
                <span>{a.name}</span>
                <span className="text-xs text-neutral-500"> · {a.depth === 0 ? t("brain.direct") : t("brain.level", { n: a.depth })}</span>
              </button>
            ))}
          </div>
        )}
        {detail ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-base font-semibold">{detail.name}</h3>
            {detail.definition && <p className="text-sm">{detail.definition}</p>}
            {detail.needs.length > 0 && <ChipRow label={t("brain.needs")} items={detail.needs} onPick={setSelected} />}
            {detail.neededBy.length > 0 && <ChipRow label={t("brain.neededBy")} items={detail.neededBy} onPick={setSelected} />}
            <div className="text-xs text-neutral-500 mt-1">{t("brain.places")}</div>
            <ul className="flex flex-col gap-1">
              {detail.places.slice(0, 12).map((p, i) => (
                <li key={i}>
                  <button type="button" className="text-left text-sm w-full rounded px-2 py-1 hover:bg-neutral-900" onClick={() => onOpenSource(p.docId, p.page)}>
                    {p.explains ? "★ " : ""}
                    {p.chapter}
                    <span className="block text-xs text-neutral-500">
                      {p.doc} · S. {p.page}
                      {p.module ? ` · ${p.module}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          !active && <p className="text-sm text-neutral-500">{t("brain.hint")}</p>
        )}
      </aside>
    </div>
  );
}

function ChipRow({ label, items, onPick }: { label: string; items: Array<{ id: string; name: string }>; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.map((i) => (
          <button key={i.id} type="button" className="chip" onClick={() => onPick(i.id)}>
            {i.name}
          </button>
        ))}
      </div>
    </div>
  );
}
