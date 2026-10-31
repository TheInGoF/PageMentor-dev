// Reranker (bge-reranker-v2-m3 im infinity-Server): liest Frage und Abschnitt zusammen und sortiert
// die Kandidaten der hybriden Suche nach echter Relevanz. Fehlt er, bleibt die RRF-Reihenfolge
import { effective } from "../llmConfig";

let cached: { url: string; model: string | null; at: number } | null = null;

async function rerankModel(url: string): Promise<string | null> {
  if (cached && cached.url === url && Date.now() - cached.at < 60_000) return cached.model;
  let model: string | null = null;
  try {
    const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      model = data.data?.map((m) => m.id ?? "").find((id) => /rerank/i.test(id)) ?? null;
    }
  } catch {
    /* Server nicht erreichbar */
  }
  cached = { url, model, at: Date.now() };
  return model;
}

// Indizes der Texte, beste zuerst; null ohne Reranker
export async function rerank(query: string, texts: string[]): Promise<number[] | null> {
  const url = effective("teiUrl", "PM_TEI_URL")?.replace(/\/+$/, "");
  if (!url || texts.length < 2) return null;
  const model = await rerankModel(url);
  if (!model) return null;
  try {
    const res = await fetch(`${url}/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, query, documents: texts, return_documents: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { results?: Array<{ index: number; relevance_score: number }> };
    const order = (data.results ?? []).slice().sort((a, b) => b.relevance_score - a.relevance_score).map((r) => r.index);
    return order.length ? order : null;
  } catch (err) {
    console.warn(`[rerank] übersprungen: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
