// Hörbuch-Lauf für mehrere Bücher: starten bzw. nachschieben, Status, fortsetzen, abbrechen, Abschluss quittieren
import { Hono } from "hono";
import { batchStatus, cancel, dismiss, enqueue, resume } from "../services/batch/audiobooks";
import { absReady } from "../services/audiobookshelf";
import { processDocument } from "../services/pipeline";
import { releaseDoclingNow } from "../services/docling/release";

// Mehrere Bücher neu umwandeln: nacheinander, nie zwei Docling-Läufe gleichzeitig
let reprocessChain: Promise<void> = Promise.resolve();

export const batchRoutes = new Hono();

batchRoutes.get("/audiobooks", (c) => c.json({ batch: batchStatus(), absReady: absReady() }));

batchRoutes.post("/audiobooks", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { docIds?: string[]; voiceId?: string; rate?: string; model?: string; abs?: boolean };
  if (!body.docIds?.length || !body.voiceId) return c.json({ error: "docIds und voiceId nötig" }, 400);
  enqueue(body.docIds, { voiceId: body.voiceId, rate: body.rate || "+0%", model: body.model || undefined, abs: !!body.abs });
  return c.json({ batch: batchStatus() });
});

batchRoutes.post("/audiobooks/resume", (c) => {
  resume();
  return c.json({ batch: batchStatus() });
});

batchRoutes.post("/audiobooks/cancel", (c) => {
  cancel();
  return c.json({ batch: batchStatus() });
});

batchRoutes.post("/audiobooks/dismiss", (c) => {
  dismiss();
  return c.json({ batch: batchStatus() });
});

batchRoutes.post("/reprocess", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { docIds?: string[] };
  const ids = body.docIds ?? [];
  for (const id of ids) reprocessChain = reprocessChain.then(() => processDocument(id)).catch(() => undefined);
  reprocessChain = reprocessChain.then(() => releaseDoclingNow());
  return c.json({ queued: ids.length });
});
