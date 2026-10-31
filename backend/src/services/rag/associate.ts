// Assoziation über die Zusammenhänge, wie ein Gedächtnis: Treffer einer Frage aktivieren die ähnlichsten
// Kapitel anderer Hefte, deren passendste Abschnitte kommen als zusätzliche Kandidaten in die Auswahl.
// So findet der Tutor auch Stellen, die die Frage nicht wörtlich treffen, aber dasselbe Thema behandeln
import { db } from "../../db";
import { cosineSim, embeddingFromBuffer } from "../embeddings";
import { centroid } from "./graph";

interface ChapterVec {
  docId: string;
  vec: Float32Array;
}

let cache: { key: string; chapters: Map<string, ChapterVec> } | null = null;

// Kapitel-Schwerpunkte aller Hefte; neu berechnet, wenn sich die Abschnitte ändern
function chapterVectors(): Map<string, ChapterVec> {
  const d = db();
  const k = d.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(rowid), 0) AS m FROM chunks WHERE embedding IS NOT NULL").get() as { n: number; m: number };
  const key = `${k.n}:${k.m}`;
  if (cache?.key === key) return cache.chapters;
  const rows = d
    .prepare("SELECT chapter_id, document_id, embedding FROM chunks WHERE embedding IS NOT NULL AND chapter_id IS NOT NULL")
    .all() as Array<{ chapter_id: string; document_id: string; embedding: Buffer }>;
  const grouped = new Map<string, { docId: string; vecs: Float32Array[] }>();
  for (const r of rows) {
    const g = grouped.get(r.chapter_id) ?? { docId: r.document_id, vecs: [] };
    g.vecs.push(embeddingFromBuffer(r.embedding));
    grouped.set(r.chapter_id, g);
  }
  const chapters = new Map([...grouped].map(([id, g]) => [id, { docId: g.docId, vec: centroid(g.vecs) }]));
  cache = { key, chapters };
  return chapters;
}

// Nächste Kapitel aus anderen Heften (optional nur im Modul), ähnlichste zuerst
export function relatedChapters(chapterIds: string[], perChapter = 2, minSim = 0.75, allowedDocs?: Set<string>): string[] {
  const all = chapterVectors();
  const seeds = new Set(chapterIds);
  const out: string[] = [];
  for (const id of chapterIds) {
    const me = all.get(id);
    if (!me) continue;
    const near = [...all]
      .filter(([cid, c]) => !seeds.has(cid) && c.docId !== me.docId && (!allowedDocs || allowedDocs.has(c.docId)))
      .map(([cid, c]) => ({ cid, s: cosineSim(me.vec, c.vec) }))
      .filter((x) => x.s >= minSim)
      .sort((a, b) => b.s - a.s)
      .slice(0, perChapter);
    for (const n of near) if (!out.includes(n.cid)) out.push(n.cid);
  }
  return out;
}

// Je verwandtem Kapitel die Abschnitte, die der Frage am nächsten sind
export function associatedChunks(query: Float32Array, chapterIds: string[], perChapter = 2): number[] {
  if (!chapterIds.length) return [];
  const rows = db()
    .prepare(`SELECT rowid, chapter_id, embedding FROM chunks WHERE embedding IS NOT NULL AND chapter_id IN (${chapterIds.map(() => "?").join(",")})`)
    .all(...chapterIds) as Array<{ rowid: number; chapter_id: string; embedding: Buffer }>;
  const out: number[] = [];
  for (const cid of chapterIds) {
    const scored = rows
      .filter((r) => r.chapter_id === cid)
      .map((r) => {
        const v = embeddingFromBuffer(r.embedding);
        return { rowid: r.rowid, s: v.length === query.length ? cosineSim(query, v) : -2 };
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, perChapter);
    out.push(...scored.map((x) => x.rowid));
  }
  return out;
}
