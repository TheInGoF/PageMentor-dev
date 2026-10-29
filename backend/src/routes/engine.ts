// Engine: Status, Selbsttest, Reparaturen, Dienst-Logs
import { Hono } from "hono";
import { IS_WINDOWS } from "../paths";
import type { RepairId } from "../engine/checks";
import { trackEngineSwitch } from "../engine/engineCleanup";
import { inDistro } from "../engine/exec";
import { engineState, runRepair, runSelftest } from "../engine/manager";
import { enabledExtras, EXTRA_SERVICES, type ExtraEngine } from "../engine/extraEngines";
import { getLlmConfig, setLlmConfig } from "../services/llmConfig";
import { extraStatus, refreshExtraStatus } from "../tts/engines/extra/probe";

export const engineRoutes = new Hono();

const REPAIRS = new Set(["enable-wsl", "import-distro", "provision", "start-docker", "pull-images", "start-services", "docling-models", "pull-model", "apply-tts-engines"]);
const SERVICES = new Set(["ollama", "docling", "qwen-tts", "kokoro-tts", "f5-tts", "tada-tts", "gpu-arbiter", "infinity", "meilisearch"]);

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

// Zusätzliche Stimmen-Engines: Auswahl und HF-Token
engineRoutes.get("/tts-engines", async (c) => {
  await refreshExtraStatus();
  return c.json({ engines: EXTRA_SERVICES, enabled: enabledExtras(), hfTokenPresent: !!getLlmConfig().hfToken, arbiter: extraStatus() });
});

engineRoutes.post("/tts-engines", async (c) => {
  const body = (await c.req.json()) as { enabled?: string[]; hfToken?: string };
  const enabled = (body.enabled ?? []).filter((e): e is ExtraEngine => e in EXTRA_SERVICES);
  setLlmConfig({ ttsEngines: enabled.join(","), ...(body.hfToken?.trim() ? { hfToken: body.hfToken.trim() } : {}) });
  trackEngineSwitch();
  // Unter Windows gleich übernehmen: Pakete laden, Dienste anlegen
  if (IS_WINDOWS && !engineState().task) void runRepair("apply-tts-engines").catch(() => {});
  return c.json({ enabled, applying: IS_WINDOWS });
});
