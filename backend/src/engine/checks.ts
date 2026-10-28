// Selbsttest: jede Prüfung liefert Status, Erklärung und ggf. Reparatur
import { statfsSync } from "fs";
import { IS_WINDOWS } from "../paths";
import { effective } from "../services/llmConfig";
import {
  COMPOSE_IN_DISTRO,
  DEFAULT_LLM_MODEL,
  DISTRO,
  DOCLING_CONTAINER,
  DOCLING_EXTRA_MODELS,
  doclingModelMark,
  ENGINE_DIR,
  ENGINE_HOST,
  MIN_FREE_GB_ERROR,
  MIN_FREE_GB_WARN,
  SERVICES,
} from "./config";
import { failText, inDistro, wsl } from "./exec";
import { enabledExtras, EXTRA_SERVICES } from "./extraEngines";
import { extraStatus, refreshExtraStatus } from "../tts/engines/extra/probe";

export type CheckStatus = "ok" | "warn" | "error" | "skipped";
export type RepairId =
  | "enable-wsl"
  | "import-distro"
  | "provision"
  | "start-docker"
  | "pull-images"
  | "start-services"
  | "pull-model"
  | "docling-models"
  | "apply-tts-engines";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  message: string;
  repair?: RepairId;
  help?: string;
  durationMs?: number;
}

interface Ctx {
  wslOk: boolean;
  distroOk: boolean;
  dockerOk: boolean;
}

const ok = (id: string, title: string, message: string): CheckResult => ({ id, title, status: "ok", message });
const skip = (id: string, title: string, why: string): CheckResult => ({ id, title, status: "skipped", message: why });

async function checkWsl(ctx: Ctx): Promise<CheckResult> {
  const t = "WSL";
  if (!IS_WINDOWS) return skip("wsl", t, "Nur unter Windows nötig");
  const r = await wsl(["--status"], { timeoutMs: 20_000, quiet: true });
  if (r.code !== 0 || /not installed|nicht installiert|optional component/i.test(r.stdout + r.stderr)) {
    return {
      id: "wsl",
      title: t,
      status: "error",
      message: "WSL ist nicht eingeschaltet. Einmalig mit Admin-Rechten einschalten, danach evtl. Neustart.",
      repair: "enable-wsl",
      help: "https://learn.microsoft.com/windows/wsl/install",
    };
  }
  ctx.wslOk = true;
  return ok("wsl", t, "WSL ist eingeschaltet");
}

async function checkDistro(ctx: Ctx): Promise<CheckResult> {
  const t = "Engine-Umgebung";
  if (!ctx.wslOk) return skip("distro", t, "Wartet auf WSL");
  const r = await wsl(["-l", "-q"], { timeoutMs: 20_000, quiet: true });
  const names = r.stdout.split(/\r?\n/).map((s) => s.replace(/\0/g, "").trim());
  if (!names.includes(DISTRO)) {
    return {
      id: "distro",
      title: t,
      status: "error",
      message: `Die Umgebung "${DISTRO}" fehlt. Reparieren lädt Ubuntu und richtet sie in ${ENGINE_DIR} ein.`,
      repair: "import-distro",
    };
  }
  ctx.distroOk = true;
  return ok("distro", t, `"${DISTRO}" ist vorhanden`);
}

async function checkProvisioned(ctx: Ctx): Promise<CheckResult> {
  const t = "Einrichtung";
  if (!ctx.distroOk) return skip("provision", t, "Wartet auf die Engine-Umgebung");
  const r = await inDistro("cat /opt/pagementor/provisioned 2>/dev/null", { timeoutMs: 60_000, quiet: true });
  if (r.code !== 0 || !r.stdout.trim()) {
    return { id: "provision", title: t, status: "error", message: "Docker und GPU-Unterstützung sind noch nicht eingerichtet.", repair: "provision" };
  }
  return ok("provision", t, `Eingerichtet (Stand ${r.stdout.trim()})`);
}

async function checkDocker(ctx: Ctx): Promise<CheckResult> {
  const t = "Docker";
  if (!ctx.distroOk) return skip("docker", t, "Wartet auf die Engine-Umgebung");
  const r = await inDistro("systemctl is-active docker && docker info --format '{{.ServerVersion}}'", { timeoutMs: 60_000, quiet: true });
  if (r.code !== 0) {
    return { id: "docker", title: t, status: "error", message: `Docker läuft nicht: ${failText(r)}`, repair: "start-docker" };
  }
  ctx.dockerOk = true;
  return ok("docker", t, `Docker ${r.stdout.trim().split("\n").pop()} läuft`);
}

async function checkGpu(ctx: Ctx): Promise<CheckResult> {
  const t = "Grafikkarte";
  if (!ctx.distroOk) return skip("gpu", t, "Wartet auf die Engine-Umgebung");
  const r = await inDistro("/usr/lib/wsl/lib/nvidia-smi -L || nvidia-smi -L", { timeoutMs: 60_000, quiet: true });
  if (r.code !== 0 || !/GPU \d/.test(r.stdout)) {
    return {
      id: "gpu",
      title: t,
      status: "error",
      message: "Keine NVIDIA-Grafikkarte in WSL sichtbar. Bitte den aktuellen NVIDIA-Treiber für Windows installieren.",
      help: "https://www.nvidia.com/Download/index.aspx",
    };
  }
  if (ctx.dockerOk) {
    const rt = await inDistro("docker info --format '{{json .Runtimes}}'", { timeoutMs: 30_000, quiet: true });
    if (!/nvidia/.test(rt.stdout)) {
      return { id: "gpu", title: t, status: "error", message: "Docker kennt die GPU noch nicht.", repair: "provision" };
    }
  }
  return ok("gpu", t, r.stdout.trim().split("\n")[0].replace(/\(UUID.*\)/, "").trim());
}

async function checkImages(ctx: Ctx): Promise<CheckResult> {
  const t = "Programmpakete";
  if (!ctx.dockerOk) return skip("images", t, "Wartet auf Docker");
  const r = await inDistro(
    `for i in $(docker compose -f ${COMPOSE_IN_DISTRO} config --images); do docker image inspect "$i" >/dev/null 2>&1 || echo "$i"; done`,
    { timeoutMs: 60_000, quiet: true }
  );
  const missing = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (r.code !== 0) return { id: "images", title: t, status: "error", message: failText(r), repair: "provision" };
  if (missing.length) {
    return { id: "images", title: t, status: "error", message: `${missing.length} fehlen: ${missing.join(", ")}. Download ca. 30 GB.`, repair: "pull-images" };
  }
  return ok("images", t, "Alle vorhanden");
}

async function checkService(svc: (typeof SERVICES)[number]): Promise<CheckResult> {
  try {
    const res = await fetch(svc.url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) return ok(`svc-${svc.id}`, svc.title, "Antwortet");
    return { id: `svc-${svc.id}`, title: svc.title, status: "error", message: `Antwortet mit HTTP ${res.status}`, repair: "start-services" };
  } catch (err) {
    return {
      id: `svc-${svc.id}`,
      title: svc.title,
      status: "error",
      message: `Nicht erreichbar (${svc.url.replace(/^https?:\/\//, "").replace("/health", "")})${/ECONNREFUSED|Unable to connect/i.test(String(err)) ? "" : `: ${err instanceof Error ? err.message : err}`}`,
      repair: IS_WINDOWS ? "start-services" : undefined,
    };
  }
}

async function checkDoclingModels(ctx: Ctx): Promise<CheckResult> {
  const t = "Docling-Modelle";
  if (!ctx.dockerOk) return skip("docling-models", t, "Wartet auf Docker");
  const tests = DOCLING_EXTRA_MODELS.map((m) => `test -f ${doclingModelMark(m.id)} || echo ${m.id}`).join("; ");
  const r = await inDistro(`docker exec ${DOCLING_CONTAINER} sh -c '${tests}'`, { timeoutMs: 30_000, quiet: true });
  if (r.code !== 0) return skip("docling-models", t, "Wartet auf Docling");
  const missing = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!missing.length) return ok("docling-models", t, DOCLING_EXTRA_MODELS.map((m) => m.title).join(", ") + " vorhanden");
  const names = DOCLING_EXTRA_MODELS.filter((m) => missing.includes(m.id)).map((m) => m.title);
  return { id: "docling-models", title: t, status: "error", message: `Fehlen: ${names.join(", ")}. Ohne sie scheitert jede Umwandlung. Download ca. 5 GB.`, repair: "docling-models" };
}

async function checkModel(): Promise<CheckResult> {
  const t = "Sprachmodell";
  const wanted = effective("ollamaModel", "PM_OLLAMA_MODEL") || DEFAULT_LLM_MODEL;
  try {
    const res = await fetch(`http://${ENGINE_HOST}:8790/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const names = (data.models ?? []).map((m) => m.name);
    const has = names.some((n) => n === wanted || n === `${wanted}:latest` || n.split(":")[0] === wanted);
    if (has) return ok("model", t, `${wanted} ist geladen`);
    return { id: "model", title: t, status: "warn", message: `${wanted} fehlt noch (vorhanden: ${names.join(", ") || "keins"})`, repair: "pull-model" };
  } catch {
    return skip("model", t, "Wartet auf den GPU-Arbiter");
  }
}

// Eingeschaltete Stimmen-Engines: Container angelegt?
async function checkExtraTts(): Promise<CheckResult | null> {
  const t = "Weitere Stimmen";
  const on = enabledExtras();
  if (!on.length) return null;
  await refreshExtraStatus();
  const st = extraStatus();
  if (!Object.keys(st).length) return skip("tts-extra", t, "Wartet auf den GPU-Arbiter");
  const missing = on.filter((e) => !st[e] || st[e].container === "missing").map((e) => EXTRA_SERVICES[e].title);
  if (missing.length) {
    return { id: "tts-extra", title: t, status: "warn", message: `Noch nicht eingerichtet: ${missing.join(", ")}`, repair: "apply-tts-engines" };
  }
  return ok("tts-extra", t, on.map((e) => EXTRA_SERVICES[e].title).join(", ") + " bereit");
}

function checkDisk(): CheckResult {
  const t = "Speicherplatz";
  try {
    const s = statfsSync(IS_WINDOWS ? ENGINE_DIR.slice(0, 3) : "/");
    const freeGb = (s.bavail * s.bsize) / 1024 ** 3;
    const msg = `${freeGb.toFixed(0)} GB frei`;
    if (freeGb < MIN_FREE_GB_ERROR) return { id: "disk", title: t, status: "error", message: `${msg}, zu wenig für Modelle und Hörbücher` };
    if (freeGb < MIN_FREE_GB_WARN) return { id: "disk", title: t, status: "warn", message: `${msg}, wird knapp` };
    return ok("disk", t, msg);
  } catch (err) {
    return { id: "disk", title: t, status: "warn", message: `Nicht ermittelbar: ${err}` };
  }
}

// Alle Prüfungen der Reihe nach; spätere warten auf frühere
export async function runChecks(onResult?: (r: CheckResult) => void): Promise<CheckResult[]> {
  const ctx: Ctx = { wslOk: false, distroOk: false, dockerOk: false };
  const results: CheckResult[] = [];
  const add = async (fn: () => Promise<CheckResult> | CheckResult) => {
    const t0 = Date.now();
    let r: CheckResult;
    try {
      r = await fn();
    } catch (err) {
      r = { id: "intern", title: "Interner Fehler", status: "error", message: String(err) };
    }
    r.durationMs = Date.now() - t0;
    results.push(r);
    onResult?.(r);
  };
  await add(() => checkWsl(ctx));
  await add(() => checkDistro(ctx));
  await add(() => checkProvisioned(ctx));
  await add(() => checkDocker(ctx));
  await add(() => checkGpu(ctx));
  await add(() => checkImages(ctx));
  for (const svc of SERVICES) await add(() => checkService(svc));
  if (IS_WINDOWS) await add(() => checkDoclingModels(ctx));
  await add(() => checkModel());
  const extra = await checkExtraTts().catch(() => null);
  if (extra) {
    results.push(extra);
    onResult?.(extra);
  }
  await add(() => checkDisk());
  return results;
}
