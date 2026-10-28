// Wissensdatenbank: Stapel-Import (Warteschlange) und Prüffragen der Suche
import { Hono } from "hono";
import { processDocument } from "../services/pipeline";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { clearFinished, enqueueFolder, queueStatus, retryFailed, runQueue, scanImportFolder, setQueueFlags, type EnqueueResult } from "../services/batch/queue";
import { IMPORT_DIR, KNOWLEDGE_DIR } from "../paths";
import { openFolder } from "../services/audiobook/export";
import { addEval, deleteEval, listEval, runEval } from "../services/rag/eval";
import { emitLog } from "../log/logger";

export const knowledgeRoutes = new Hono();

export function startQueue(): void {
  void runQueue((id) => processDocument(id)).catch((err) => emitLog("error", "batch", "Stapel-Import abgebrochen", { err }));
}

// Import-Ordner einlesen; neue PDFs gehen in die Warteschlange
async function scanImport(): Promise<EnqueueResult | null> {
  const r = await scanImportFolder();
  if (r && (r.added || r.duplicates.length)) {
    emitLog("info", "batch", `Import-Ordner: ${r.added} neu, ${r.duplicates.length} Dubletten`);
    startQueue();
  }
  return r;
}

// Beim Start und alle zwei Minuten nachsehen
export function watchImportFolder(): void {
  try {
    mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    mkdirSync(IMPORT_DIR, { recursive: true });
    const hint = join(IMPORT_DIR, "LIESMICH.txt");
    if (!existsSync(hint))
      writeFileSync(hint, "PDFs hier hineinlegen (Unterordner erlaubt). PageMentor liest sie automatisch ein.\r\nVerarbeitete Dateien landen in \"Erledigt\", doppelte in \"Dubletten\".\r\n");
  } catch (err) {
    emitLog("warn", "batch", "Import-Ordner konnte nicht angelegt werden", { err });
  }
  const tick = () => void scanImport().catch((err) => emitLog("warn", "batch", "Import-Ordner nicht lesbar", { err }));
  tick();
  setInterval(tick, 2 * 60_000).unref?.();
}

knowledgeRoutes.get("/folders", (c) => c.json({ importDir: IMPORT_DIR, knowledgeDir: KNOWLEDGE_DIR }));
knowledgeRoutes.post("/folders/open", async (c) => {
  const { which } = (await c.req.json()) as { which?: string };
  const dir = which === "knowledge" ? KNOWLEDGE_DIR : IMPORT_DIR;
  mkdirSync(dir, { recursive: true });
  return c.json({ opened: openFolder(dir), path: dir });
});
knowledgeRoutes.post("/import/scan", async (c) => {
  try {
    return c.json((await scanImport()) ?? { added: 0, skipped: 0, withMarkdown: 0, duplicates: [] });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

knowledgeRoutes.get("/batch", (c) => c.json(queueStatus()));
knowledgeRoutes.post("/batch", async (c) => {
  const body = (await c.req.json()) as { folder?: string; docType?: string; moduleId?: string | null; mdFolder?: string | null };
  if (!body.folder?.trim()) return c.json({ error: "Ordner fehlt" }, 400);
  try {
    const r = await enqueueFolder(body.folder.trim(), { docType: body.docType, moduleId: body.moduleId || null, mdFolder: body.mdFolder?.trim() || null });
    emitLog("info", "batch", `Stapel-Import: ${r.added} neu in der Warteschlange, ${r.skipped} schon vorhanden, ${r.duplicates.length} Dubletten, ${r.withMarkdown} mit Docling-Markdown`);
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
