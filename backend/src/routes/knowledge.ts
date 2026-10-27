// Wissensdatenbank: Stapel-Import (Warteschlange) und Prüffragen der Suche
import { Hono } from "hono";
import { processDocument } from "../services/pipeline";
import { clearFinished, enqueueFolder, queueStatus, retryFailed, runQueue, setQueueFlags } from "../services/batch/queue";
import { addEval, deleteEval, listEval, runEval } from "../services/rag/eval";
import { emitLog } from "../log/logger";

export const knowledgeRoutes = new Hono();

export function startQueue(): void {
  void runQueue((id) => processDocument(id)).catch((err) => emitLog("error", "batch", "Stapel-Import abgebrochen", { err }));
}

knowledgeRoutes.get("/batch", (c) => c.json(queueStatus()));
knowledgeRoutes.post("/batch", async (c) => {
  const body = (await c.req.json()) as { folder?: string; docType?: string; moduleId?: string | null; mdFolder?: string | null };
  if (!body.folder?.trim()) return c.json({ error: "Ordner fehlt" }, 400);
  try {
    const r = enqueueFolder(body.folder.trim(), { docType: body.docType, moduleId: body.moduleId || null, mdFolder: body.mdFolder?.trim() || null });
    emitLog("info", "batch", `Stapel-Import: ${r.added} neu in der Warteschlange, ${r.skipped} schon vorhanden, ${r.withMarkdown} mit Docling-Markdown`);
    startQueue();
    return c.json(r);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
knowledgeRoutes.post("/batch/flags", async (c) => {
  const body = (await c.req.json()) as { paused?: boolean; nightOnly?: boolean };
  setQueueFlags(body);
  if (body.paused === false || body.nightOnly !== undefined) startQueue();
  return c.json(queueStatus());
});
knowledgeRoutes.post("/batch/retry", (c) => {
  const n = retryFailed();
  startQueue();
  return c.json({ retried: n });
});
knowledgeRoutes.post("/batch/clear", (c) => c.json({ removed: clearFinished() }));

knowledgeRoutes.get("/eval", (c) => c.json({ questions: listEval() }));
knowledgeRoutes.post("/eval", async (c) => {
  try {
    return c.json(addEval(await c.req.json()));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
knowledgeRoutes.delete("/eval/:id", (c) => c.json({ deleted: deleteEval(c.req.param("id")) }));
knowledgeRoutes.post("/eval/run", async (c) => c.json(await runEval(Number(c.req.query("k")) || 12)));
