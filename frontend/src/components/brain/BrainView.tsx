// Gehirn: das Begriffsnetz über alle Module, fachübergreifend in einem Bild. Punkte sind Begriffe (Größe = Fundstellen),
// Linien „baut auf“ mit Pfeil zur Grundlage, gestrichelt = ungesichert. Herausgezoomt stehen Hefte und Module als
// Themen, hineingezoomt die Begriffe. Schlagwort: Treffer werden grün. „Aktivieren“: die Begriffe leuchten, die der
// Tutor für die Eingabe nutzen würde, mit Ebenen 1–3
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { Menu } from "../ui/Menu";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { brainLayout } from "./layout";

interface BrainNode { id: string; name: string; mentions: number; moduleId: string | null; docId: string | null; modules: number; explained: boolean }
interface BrainEdge { a: string; b: string; weight: number; sure: boolean }
interface Graph {
  nodes: BrainNode[];
  edges: BrainEdge[];
  modules: Array<{ id: string; name: string; icon: string | null }>;
  docs: Array<{ id: string; title: string; moduleId: string | null }>;
  total: { concepts: number; links: number };
}
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
// 0 = alle Begriffe
const SIZES = [80, 150, 300, 0];
const MAX_ZOOM = 12;
// Ab dieser Vergrößerung stehen die Begriffe statt der Themen
const TOPIC_ZOOM = 2;
const NEUTRAL = "rgb(var(--neutral-400, 160 160 160))";
const ACCENT = "rgb(var(--accent))";
const GREEN = "#22c55e";
const GREEN_SOFT = "#86efac";
type View = { x: number; y: number; w: number; h: number };
const FULL: View = { x: 0, y: 0, w: W, h: H };

// Ausschnitt um einen Punkt (Bildkoordinaten) skalieren; der Punkt bleibt unter dem Mauszeiger stehen
function zoomAt(v: View, px: number, py: number, factor: number): View {
  const w = Math.min(W, Math.max(W / MAX_ZOOM, v.w / factor));
  const f = v.w / w;
  const h = (H / W) * w;
  return clampView({ x: px - (px - v.x) / f, y: py - (py - v.y) / f, w, h });
}

// Nicht aus dem Bild herausschieben
function clampView(v: View): View {
  return { ...v, x: Math.min(W - v.w, Math.max(0, v.x)), y: Math.min(H - v.h, Math.max(0, v.y)) };
}

// Themen fürs herausgezoomte Bild: Schwerpunkt je Heft und je Modul
function topicsOf(graph: Graph, pos: Map<string, { x: number; y: number }>) {
  const sum = new Map<string, { x: number; y: number; n: number }>();
  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    if (!p || !n.docId) continue;
    const s = sum.get(n.docId) ?? { x: 0, y: 0, n: 0 };
    sum.set(n.docId, { x: s.x + p.x, y: s.y + p.y, n: s.n + 1 });
  }
  const docs = graph.docs.filter((d) => sum.has(d.id)).map((d) => ({ ...d, x: sum.get(d.id)!.x / sum.get(d.id)!.n, y: sum.get(d.id)!.y / sum.get(d.id)!.n, n: sum.get(d.id)!.n }));
  const modules = graph.modules
    .map((m) => {
      const ds = docs.filter((d) => d.moduleId === m.id);
      const n = ds.reduce((a, d) => a + d.n, 0);
      return n ? { id: m.id, name: m.name, x: ds.reduce((a, d) => a + d.x * d.n, 0) / n, y: ds.reduce((a, d) => a + d.y * d.n, 0) / n, single: ds.length === 1 && ds[0].title === m.name } : null;
    })
    .filter((m): m is NonNullable<typeof m> => !!m);
  return { docs, modules };
}

export function BrainView({ onOpenSource }: { onOpenSource: (docId: string, page: number) => void }) {
  const [moduleId, setModuleId] = useState("");
  const [limit, setLimit] = useState(150);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Set<string> | null>(null);
  const [active, setActive] = useState<Active[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [noEmbeddings, setNoEmbeddings] = useState(false);
  // Zoom mit dem Mausrad an der Mausposition, Verschieben durch Ziehen auf freier Fläche
  const [view, setView] = useState<View>(FULL);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean } | null>(null);
  const toSvg = (clientX: number, clientY: number, v: View) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: v.x + ((clientX - r.left) / r.width) * v.w, y: v.y + ((clientY - r.top) / r.height) * v.h };
  };
  useEffect(() => setView(FULL), [moduleId, limit]);
  // Eigener Listener: Reacts onWheel ist passiv und könnte das Scrollen der Seite nicht verhindern
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const p = toSvg(e.clientX, e.clientY, v);
        return zoomAt(v, p.x, p.y, Math.exp(-e.deltaY * 0.0015));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false };
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) svgRef.current?.setPointerCapture(e.pointerId);
    d.moved = true;
    const r = svgRef.current!.getBoundingClientRect();
    setView(clampView({ ...d.v, x: d.v.x - (dx / r.width) * d.v.w, y: d.v.y - (dy / r.height) * d.v.h }));
  };
  const onPointerUp = () => {
    // Nach dem Ziehen kein Klick (würde die Auswahl aufheben)
    setTimeout(() => (drag.current = null), 0);
  };
  const zoomBy = (factor: number) => setView((v) => zoomAt(v, v.x + v.w / 2, v.y + v.h / 2, factor));

  useEffect(() => {
    setActive(null);
    void request<Graph>(`/api/concepts/brain?limit=${limit || "all"}${moduleId ? `&moduleId=${moduleId}` : ""}`).then(setGraph).catch(() => undefined);
  }, [moduleId, limit]);
  useEffect(() => {
    if (!selected) return setDetail(null);
    void request<Detail>(`/api/concepts/${selected}`).then(setDetail).catch(() => setDetail(null));
  }, [selected]);
  // Schlagwortsuche beim Tippen, leicht verzögert
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setHits(null);
    const timer = setTimeout(() => {
      void request<{ hits: string[] }>(`/api/concepts/brain/search?q=${encodeURIComponent(q)}`).then((r) => setHits(new Set(r.hits))).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const pos = useMemo(
    () => (graph ? brainLayout(graph.nodes.map((n) => n.id), graph.edges, W, H, 60, { of: new Map(graph.nodes.map((n) => [n.id, n.docId ?? ""])), order: graph.docs.map((d) => d.id) }) : null),
    [graph]
  );
  const topics = useMemo(() => (graph && pos ? topicsOf(graph, pos) : null), [graph, pos]);
  // Nachbarn der Treffer: hellgrün
  const nearHits = useMemo(() => {
    const s = new Set<string>();
    if (hits && graph) for (const e of graph.edges) {
      if (hits.has(e.a)) s.add(e.b);
      if (hits.has(e.b)) s.add(e.a);
    }
    return s;
  }, [hits, graph]);

  if (!graph || !pos || !topics) return <div className="text-sm text-neutral-500">{t("common.loading")}</div>;
  if (!graph.total.concepts)
    return <div className="card p-8 text-center text-sm text-neutral-500">{t("brain.empty")}</div>;

  const activeById = new Map((active ?? []).map((a) => [a.id, a]));
  const focus = hover ?? selected;
  const near = new Set(graph.edges.filter((e) => e.a === focus || e.b === focus).flatMap((e) => [e.a, e.b]));
  // Hineingezoomt: Punkte und Schrift behalten ihre Bildschirmgröße, dafür stehen die Begriffe da
  const k = W / view.w;
  const radius = (n: BrainNode) => Math.min(14, 3 + Math.sqrt(n.mentions) * 2) / Math.sqrt(k);
  const conceptLabels = k >= TOPIC_ZOOM;
  const hitList = hits ? graph.nodes.filter((n) => hits.has(n.id)) : [];
  // Was gerade im Vordergrund steht: Treffer, Aktivierung oder der Begriff unter der Maus
  const dim = (id: string) => (hits ? !hits.has(id) && !nearHits.has(id) : active ? !activeById.has(id) : focus ? !near.has(id) && id !== focus : false);
  const fill = (id: string) => (hits?.has(id) ? GREEN : nearHits.has(id) ? GREEN_SOFT : activeById.has(id) ? ACCENT : NEUTRAL);
  const context = !!(hits || active || focus);

  async function ask(e?: FormEvent) {
    e?.preventDefault();
    if (!query.trim() || !graph) return;
    setBusy(true);
    try {
      const r = await request<{ active: Active[]; nodes: BrainNode[]; edges: BrainEdge[]; embeddings: boolean }>("/api/concepts/brain/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query, have: graph.nodes.map((n) => n.id) }),
      });
      setNoEmbeddings(!r.embeddings);
      if (r.nodes.length) setGraph({ ...graph, nodes: [...graph.nodes, ...r.nodes], edges: [...graph.edges, ...r.edges] });
      setHits(null);
      setActive(r.active);
      setSelected(r.active[0]?.id ?? null);
    } finally {
      setBusy(false);
    }
  }
  const reset = () => {
    setQuery("");
    setHits(null);
    setActive(null);
  };

  // Begriffsnetz als Markdown herunterladen (gewählter Bereich), z. B. zum Prüfen durch ein großes Modell
  const exportBrain = (excerpt: number) => {
    const a = document.createElement("a");
    a.href = `/api/concepts/brain/export?excerpt=${excerpt}${moduleId ? `&moduleId=${moduleId}` : ""}`;
    a.download = "";
    a.click();
  };

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
                  {s ? t("brain.size", { n: s }) : t("brain.sizeAll")}
                </button>
              ))}
            </div>
            <Menu
              label={t("brain.actions")}
              items={[
                { label: t("brain.exportWithText"), onClick: () => exportBrain(800) },
                { label: t("brain.exportPlain"), onClick: () => exportBrain(0) },
              ]}
            />
          </div>
          <form onSubmit={(e) => e.preventDefault()} className="flex gap-2">
            <input className="input flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("brain.searchPlaceholder")} />
            <Button type="button" disabled={busy || !query.trim()} onClick={() => void ask()}>
              {t("brain.activate")}
            </Button>
            {(active || hits) && (
              <Button type="button" variant="ghost" onClick={reset}>
                {t("brain.reset")}
              </Button>
            )}
          </form>
          <p className="text-xs text-neutral-500">
            {t("brain.stats", { shown: graph.nodes.length, total: graph.total.concepts, links: graph.total.links })}
            {hits && ` · ${hitList.length ? t("brain.hits", { n: hitList.length }) : t("brain.noHits")}`}
            {noEmbeddings && ` · ${t("brain.noEmbeddings")}`}
          </p>
        </div>

        <div className="card p-2 overflow-x-auto relative">
          <div className="absolute right-3 top-3 z-10 flex gap-1">
            <button type="button" className="chip min-w-[36px] justify-center" onClick={() => zoomBy(1.5)} aria-label={t("brain.zoomIn")}>
              +
            </button>
            <button type="button" className="chip min-w-[36px] justify-center" onClick={() => zoomBy(1 / 1.5)} aria-label={t("brain.zoomOut")} disabled={view.w >= W}>
              −
            </button>
            {view.w < W && (
              <button type="button" className="chip" onClick={() => setView(FULL)}>
                {t("brain.zoomReset")}
              </button>
            )}
          </div>
          <svg
            ref={svgRef}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            className={cn("w-full min-w-[560px] h-auto touch-none select-none", view.w < W && "cursor-grab active:cursor-grabbing")}
            role="img"
            aria-label={t("brain.title")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={() => !drag.current?.moved && setSelected(null)}
          >
            <defs>
              <marker id="brain-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
              <marker id="brain-arrow-dim" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" fillOpacity={0.35} />
              </marker>
            </defs>
            {graph.edges.map((e, i) => {
              const pa = pos.get(e.a), pb = pos.get(e.b);
              if (!pa || !pb) return null;
              const green = !!hits && (hits.has(e.a) || hits.has(e.b));
              const lit = green || (active ? activeById.has(e.a) && activeById.has(e.b) : !hits && !!focus && (e.a === focus || e.b === focus));
              return (
                <line
                  key={i}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  className={green ? undefined : lit ? "text-accent" : "text-neutral-500"}
                  style={green ? { color: GREEN } : undefined}
                  stroke="currentColor"
                  strokeOpacity={(lit ? 0.9 : context ? 0.06 : 0.3) * (e.sure ? 1 : 0.6)}
                  strokeWidth={(lit ? 1.6 : 0.8) / k}
                  strokeDasharray={e.sure ? undefined : `${3 / k} ${3 / k}`}
                  markerEnd={lit ? "url(#brain-arrow)" : context ? undefined : "url(#brain-arrow-dim)"}
                />
              );
            })}
            {graph.nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const a = activeById.get(n.id);
              const r = radius(n);
              const labeled = conceptLabels || !!a || hits?.has(n.id) || near.has(n.id) || focus === n.id;
              return (
                <g
                  key={n.id}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!drag.current?.moved) setSelected(n.id);
                  }}
                  opacity={dim(n.id) ? 0.2 : a ? Math.max(0.45, a.strength > 1 ? 1 : a.strength + 0.3) : 1}
                >
                  {/* Große Trefferfläche, auch für kleine Punkte */}
                  <circle cx={p.x} cy={p.y} r={Math.max(r, 10 / k)} fill="transparent" />
                  <circle cx={p.x} cy={p.y} r={r} fill={fill(n.id)} stroke={selected === n.id || a?.depth === 0 ? "currentColor" : "none"} strokeWidth={2 / k} />
                  {n.modules > 1 && <circle cx={p.x} cy={p.y} r={r + 3 / k} fill="none" stroke={NEUTRAL} strokeOpacity={0.7} strokeWidth={1 / k} strokeDasharray={`${2 / k} ${2 / k}`} />}
                  {labeled && (
                    <text x={p.x} y={p.y - r - 4 / k} textAnchor="middle" className="fill-current" fontSize={11 / k} style={{ paintOrder: "stroke", stroke: "rgb(var(--bg, 255 255 255))", strokeWidth: 3 / k }}>
                      {a && a.depth > 0 ? `${n.name} · ${a.depth}` : n.name}
                    </text>
                  )}
                </g>
              );
            })}
            {/* Themen: Hefte und Module, solange man herausgezoomt ist und nichts hervorgehoben wird */}
            {!conceptLabels && !hits && !active && (
              <g className="fill-current pointer-events-none" style={{ paintOrder: "stroke", stroke: "rgb(var(--bg, 255 255 255))", strokeWidth: 4 / k }}>
                {topics.modules.map((m) => (
                  <text key={m.id} x={m.x} y={m.y - (m.single ? 0 : 16 / k)} textAnchor="middle" fontSize={18 / k} fontWeight={700} opacity={0.75}>
                    {m.name}
                  </text>
                ))}
                {topics.docs.map((d) => {
                  const m = topics.modules.find((x) => x.id === d.moduleId);
                  if (m?.single) return null;
                  return (
                    <text key={d.id} x={d.x} y={d.y + 4 / k} textAnchor="middle" fontSize={13 / k} fontWeight={600} opacity={0.9}>
                      {d.title}
                    </text>
                  );
                })}
              </g>
            )}
          </svg>
        </div>
        <div className="text-xs text-neutral-500">{t("brain.legend")}</div>
      </div>

      <aside className="card p-4 flex flex-col gap-3 h-fit">
        {hits && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{t("brain.hits", { n: hitList.length })}</h3>
            {hitList.slice(0, 40).map((n) => (
              <button key={n.id} type="button" className={cn("text-left text-sm rounded px-2 py-1 hover:bg-neutral-900", selected === n.id && "bg-neutral-900")} onClick={() => setSelected(n.id)}>
                {n.name}
              </button>
            ))}
          </div>
        )}
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
          !active && !hits && <p className="text-sm text-neutral-500">{t("brain.hint")}</p>
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
