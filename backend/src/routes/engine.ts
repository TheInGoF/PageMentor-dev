// Engine: Status, Selbsttest, Reparaturen, Dienst-Logs
import { Hono } from "hono";
import { enabledLlmExtras, installedModels, isInstalled, setLlmExtras } from "../engine/llmExtras";
import { DEFAULT_LLM_BUDGET, DEFAULT_LLM_MODEL, EXTRA_LLMS } from "../engine/config";
import { baseUrl } from "../tts/engines/qwen/config";
import { IS_WINDOWS } from "../paths";
import type { RepairId } from "../engine/checks";
import { trackEngineSwitch } from "../engine/engineCleanup";
import { inDistro } from "../engine/exec";
import { engineState, runRepair, runSelftest } from "../engine/manager";
import { enabledExtras, EXTRA_SERVICES, type ExtraEngine } from "../engine/extraEngines";
import { effective, getLlmConfig, setLlmConfig } from "../services/llmConfig";
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

// Zusätzliche Sprachmodelle für den Tutor: Auswahl, Stand, Tutor-Modell
engineRoutes.get("/llm-models", async (c) => {
  const installed = await installedModels();
  return c.json({
    defaultModel: effective("ollamaModel", "PM_OLLAMA_MODEL") || DEFAULT_LLM_MODEL,
    defaultBudget: DEFAULT_LLM_BUDGET,
    models: EXTRA_LLMS,
    enabled: enabledLlmExtras(),
    installed: installed ? Object.keys(EXTRA_LLMS).filter((m) => isInstalled(installed, m)) : null,
    tutorModel: getLlmConfig().tutorModel ?? "",
    learnModelLanguage: getLlmConfig().learnModelLanguage ?? "",
    learnModelSubject: getLlmConfig().learnModelSubject ?? "",
  });
});

engineRoutes.post("/llm-models", async (c) => {
  const body = (await c.req.json()) as { enabled?: string[]; tutorModel?: string; learnModelLanguage?: string; learnModelSubject?: string };
  await setLlmExtras(body.enabled ?? [], body.tutorModel);
  // Lernhörbuch-Modelle: leer = Vorschlag der App; abgewählte Modelle fallen auf den Vorschlag zurück
  const keep = (m?: string) => (m && enabledLlmExtras().includes(m) ? m : "");
  if (body.learnModelLanguage !== undefined || body.learnModelSubject !== undefined) {
    setLlmConfig({ learnModelLanguage: keep(body.learnModelLanguage), learnModelSubject: keep(body.learnModelSubject) });
  }
  // Neue Auswahl gleich laden (Windows-Engine)
  const pulling = IS_WINDOWS && enabledLlmExtras().length > 0 && !engineState().task;
  if (pulling) void runRepair("pull-model").catch(() => {});
  return c.json({ enabled: enabledLlmExtras(), tutorModel: getLlmConfig().tutorModel ?? "", pulling });
});

// Kokoro-Sprachpaket (Englisch, Spanisch): Stand und Download im Sidecar
engineRoutes.get("/kokoro-pack", async (c) => {
  const r = await fetch(`${baseUrl()}/tts/kokoro/v1/audio/packs`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!r?.ok) return c.json({ installed: false, downloading: false, fraction: 0, error: "Kokoro nicht erreichbar", available: false });
  return c.json({ ...((await r.json()) as object), available: true });
});

engineRoutes.post("/kokoro-pack", async (c) => {
  const r = await fetch(`${baseUrl()}/tts/kokoro/v1/audio/packs/install`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!r?.ok) return c.json({ error: "Kokoro nicht erreichbar" }, 503);
  void refreshExtraStatus();
  return c.json((await r.json()) as object);
});
