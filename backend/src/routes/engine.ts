// Engine: Status, Selbsttest, Reparaturen, Dienst-Logs
import { Hono } from "hono";
import { IS_WINDOWS } from "../paths";
import type { RepairId } from "../engine/checks";
import { inDistro } from "../engine/exec";
import { engineState, runRepair, runSelftest } from "../engine/manager";

export const engineRoutes = new Hono();

const REPAIRS = new Set(["enable-wsl", "import-distro", "provision", "start-docker", "pull-images", "start-services", "pull-model"]);
const SERVICES = new Set(["ollama", "docling", "qwen-tts", "gpu-arbiter", "infinity", "meilisearch"]);

engineRoutes.get("/status", (c) => c.json({ ...engineState(), windows: IS_WINDOWS }));

engineRoutes.post("/selftest", async (c) => c.json({ results: await runSelftest() }));

// Reparatur im Hintergrund, Fortschritt über /status
engineRoutes.post("/repair/:id", (c) => {
  const id = c.req.param("id");
  if (!REPAIRS.has(id)) return c.json({ error: "unbekannte Reparatur" }, 400);
  if (engineState().task) return c.json({ error: `Es läuft schon: ${engineState().task!.title}` }, 409);
  void runRepair(id as RepairId).catch(() => {});
  return c.json({ started: true });
});

// Letzte Zeilen eines Dienstes, ersetzt die Log-Bridge
engineRoutes.get("/logs/:service", async (c) => {
  const service = c.req.param("service");
  if (!SERVICES.has(service)) return c.json({ error: "unbekannter Dienst" }, 400);
  if (!IS_WINDOWS) return c.json({ lines: [], note: "Nur unter Windows" });
  const r = await inDistro(`docker logs --tail 300 --timestamps pm-${service} 2>&1`, { timeoutMs: 30_000, quiet: true });
  return c.json({ lines: (r.stdout || r.stderr).split("\n").filter(Boolean) });
});
