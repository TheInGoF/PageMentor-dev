// Zusammenhänge: Kapitel als Punkte, Linien zu ähnlichen Kapiteln anderer Hefte
import { useEffect, useMemo, useState } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { cn } from "../../lib/cn";
import { ConceptList } from "./ConceptList";

interface Node { id: string; title: string; documentId: string; documentTitle: string; page: number }
interface Edge { a: string; b: string; weight: number; terms?: string[] }
interface Topic { terms: string[]; nodes: string[] }

// Kategorien in fester Reihenfolge (geprüfte Palette), ab dem neunten Heft grau
const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const W = 720;
const H = 460;

// Kräfte-Layout, deterministisch: Startpunkte auf einem Kreis, 300 Schritte
function layout(nodes: Node[], edges: Edge[]): Map<string, { x: number; y: number }> {
  const pos = new Map(nodes.map((n, i) => [n.id, { x: W / 2 + Math.cos((i / nodes.length) * 2 * Math.PI) * 180, y: H / 2 + Math.sin((i / nodes.length) * 2 * Math.PI) * 150 }]));
  const k = Math.sqrt((W * H) / Math.max(1, nodes.length)) * 0.6;
  for (let step = 0; step < 300; step++) {
    const temp = 20 * (1 - step / 300);
    const disp = new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }]));
    for (const a of nodes)
      for (const b of nodes) {
        if (a === b) continue;
        const pa = pos.get(a.id)!, pb = pos.get(b.id)!;
        const dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.max(1, Math.hypot(dx, dy));
        const f = (k * k) / d;
        disp.get(a.id)!.x += (dx / d) * f;
        disp.get(a.id)!.y += (dy / d) * f;
      }
    for (const e of edges) {
      const pa = pos.get(e.a)!, pb = pos.get(e.b)!;
      const dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.max(1, Math.hypot(dx, dy));
      const f = ((d * d) / k) * e.weight;
      disp.get(e.a)!.x -= (dx / d) * f;
      disp.get(e.a)!.y -= (dy / d) * f;
      disp.get(e.b)!.x += (dx / d) * f;
      disp.get(e.b)!.y += (dy / d) * f;
    }
    // Schwerkraft zur Mitte hält getrennte Gruppen beisammen
    for (const n of nodes) {
      const p = pos.get(n.id)!, dd = disp.get(n.id)!;
      dd.x += (W / 2 - p.x) * 0.08 * k / 10;
      dd.y += (H / 2 - p.y) * 0.08 * k / 10;
    }
    for (const n of nodes) {
      const p = pos.get(n.id)!, dd = disp.get(n.id)!, l = Math.max(1, Math.hypot(dd.x, dd.y));
      p.x = Math.min(W - 16, Math.max(16, p.x + (dd.x / l) * Math.min(l, temp)));
      p.y = Math.min(H - 16, Math.max(16, p.y + (dd.y / l) * Math.min(l, temp)));
    }
  }
  return pos;
}

type GraphData = { nodes: Node[]; edges: Edge[]; topics?: Topic[]; truncated: boolean };

// Lesbarer Export zum Prüfen: Verbindungen mit Kapitel- und Heftnamen, dazu Kennzahlen
export function graphExport(moduleName: string, data: GraphData) {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const label = (id: string) => {
    const n = byId.get(id);
    return n ? `${n.documentTitle} · ${n.title} (S. ${n.page})` : id;
  };
  const weights = data.edges.map((e) => e.weight).sort((a, b) => a - b);
  return {
    module: moduleName,
    exportedAt: new Date().toISOString(),
    stats: {
      chapters: data.nodes.length,
      documents: new Set(data.nodes.map((n) => n.documentId)).size,
      edges: data.edges.length,
      weightMin: weights[0] ?? null,
      weightMedian: weights.length ? weights[Math.floor(weights.length / 2)] : null,
      weightMax: weights[weights.length - 1] ?? null,
      truncated: data.truncated,
    },
    topics: (data.topics ?? []).map((tp) => ({ terms: tp.terms, chapters: tp.nodes.map(label) })),
    edges: [...data.edges].sort((a, b) => b.weight - a.weight).map((e) => ({ weight: e.weight, terms: e.terms ?? [], a: label(e.a), b: label(e.b) })),
    nodes: data.nodes,
  };
}

export function GraphPanel({ moduleId, moduleName, onOpenDocument }: { moduleId: string; moduleName: string; onOpenDocument: (id: string) => void }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"topics" | "concepts" | "graph">("topics");
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    void request<GraphData>(`/api/study/graph/${moduleId}`).then(setData);
  }, [moduleId]);
  const pos = useMemo(() => (data ? layout(data.nodes, data.edges) : null), [data]);

  if (!data || !pos) return <div className="text-sm text-neutral-500">{t("common.loading")}</div>;
  if (!data.nodes.length) return <div className="card p-8 text-center text-sm text-neutral-500">{t("graph.empty")}</div>;

  const dark = document.documentElement.dataset.theme === "dark";
  const docs = [...new Map(data.nodes.map((n) => [n.documentId, n.documentTitle])).entries()];
  const color = (docId: string) => {
    const i = docs.findIndex(([id]) => id === docId);
    return i < 8 ? (dark ? DARK : LIGHT)[i] : "rgb(var(--neutral-400, 160 160 160))";
  };
  const json = () => JSON.stringify(graphExport(moduleName, data), null, 2);
  const download = () => {
    const url = URL.createObjectURL(new Blob([json()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `zusammenhaenge-${moduleName.replace(/[^\w-]+/g, "_")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(json());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const near = new Set(data.edges.filter((e) => e.a === hover || e.b === hover).flatMap((e) => [e.a, e.b]));

  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["topics", "concepts", "graph"] as const).map((v) => (
          <button key={v} type="button" className={cn("chip", view === v && "chip-active")} onClick={() => setView(v)}>
            {t(`graph.view.${v}`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">{t(view === "topics" ? "graph.topicsHint" : view === "concepts" ? "concepts.hint" : "graph.hint")}</p>
      {view === "concepts" ? (
        <ConceptList moduleId={moduleId} moduleName={moduleName} onOpenDocument={onOpenDocument} />
      ) : view === "topics" ? (
        <TopicList topics={data.topics ?? []} byId={byId} color={color} onOpenDocument={onOpenDocument} />
      ) : (
        <>
      <div className="card p-2 overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px] h-auto max-h-[520px]" role="img" aria-label={t("graph.title")}>
              {data.edges.map((e) => {
                const a = pos.get(e.a)!, b = pos.get(e.b)!;
                const on = hover && (e.a === hover || e.b === hover);
                return (
              <line key={`${e.a}|${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" className={on ? "text-accent" : "text-neutral-400"} strokeOpacity={on ? 0.9 : 0.25} strokeWidth={on ? 2 : 1}>
                {e.terms?.length ? <title>{e.terms.join(" · ")}</title> : null}
              </line>
            );
              })}
              {data.nodes.map((n) => {
                const p = pos.get(n.id)!;
                const dim = hover && hover !== n.id && !near.has(n.id);
                return (
                  <g key={n.id} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer" onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => onOpenDocument(n.documentId)}>
                    <circle r={14} fill="transparent" />
                    <circle r={6} fill={color(n.documentId)} stroke="rgb(var(--bg-card))" strokeWidth={2} opacity={dim ? 0.25 : 1} />
                    <title>{`${n.title}\n${n.documentTitle}, S. ${n.page}`}</title>
                    {hover === n.id && (
                      <text y={-12} textAnchor="middle" className="fill-current text-[11px]">
                        {n.title.slice(0, 40)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {docs.map(([id, title], i) => (
          <span key={id} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: color(id) }} />
            {i < 8 ? title : t("graph.more")}
          </span>
        ))}
      </div>
      {data.truncated && <p className="text-xs text-amber-600">{t("graph.truncated")}</p>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={download}>
          {t("graph.exportJson")}
        </Button>
        <Button variant="ghost" onClick={() => void copy()}>
          {copied ? t("graph.copied") : t("graph.copyJson")}
        </Button>
      </div>
    </div>
  );
}

// Themen: Kapitel verschiedener Hefte, die dasselbe behandeln; Klick öffnet das Heft
function TopicList({
  topics,
  byId,
  color,
  onOpenDocument,
}: {
  topics: Topic[];
  byId: Map<string, Node>;
  color: (docId: string) => string;
  onOpenDocument: (id: string) => void;
}) {
  if (!topics.length) return <div className="card p-8 text-center text-sm text-neutral-500">{t("graph.noTopics")}</div>;
  return (
    <ul className="flex flex-col gap-4">
      {topics.map((tp, i) => {
        const members = tp.nodes.map((id) => byId.get(id)).filter((n): n is Node => !!n).sort((a, b) => a.documentTitle.localeCompare(b.documentTitle) || a.page - b.page);
        return (
          <li key={i} className="card p-4 flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{tp.terms.length ? tp.terms.join(" · ") : t("graph.topicUnnamed")}</h3>
            <ul className="flex flex-col divide-y divide-border">
              {members.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => onOpenDocument(n.documentId)} className="w-full flex items-center gap-2 py-2 text-left text-sm hover:text-accent">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color(n.documentId) }} />
                    <span className="flex-1 min-w-0 truncate">{n.title}</span>
                    <span className="text-xs text-neutral-500 truncate max-w-[45%]">
                      {n.documentTitle}, S. {n.page}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
