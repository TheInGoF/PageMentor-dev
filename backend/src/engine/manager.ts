// Engine-Manager: Selbsttest, Reparaturen, automatischer Start, Wachhalter
import { spawn, type ChildProcess } from "child_process";
import { IS_WINDOWS } from "../paths";
import { describeError } from "../log/errors";
import { registerDiagnostic } from "../log/diagnostics";
import { runChecks, type CheckResult, type RepairId } from "./checks";
import { DISTRO } from "./config";
import { logEngine } from "./exec";
import { repairTitle, runRepairAction } from "./repairs";

export interface RunningTask {
  repair: RepairId;
  title: string;
  message: string;
  fraction?: number;
  startedAt: number;
}

interface EngineState {
  results: CheckResult[];
  checkedAt: number;
  checking: boolean;
  task: RunningTask | null;
  lastError: string | null;
  autoStart: "aus" | "läuft" | "fertig" | "braucht-hilfe";
}

const state: EngineState = {
  results: [],
  checkedAt: 0,
  checking: false,
  task: null,
  lastError: null,
  autoStart: "aus",
};

export function engineState(): EngineState {
  return state;
}

let checkPromise: Promise<CheckResult[]> | null = null;

export function runSelftest(): Promise<CheckResult[]> {
  if (checkPromise) return checkPromise;
  state.checking = true;
  const partial: CheckResult[] = [];
  checkPromise = runChecks((r) => {
    partial.push(r);
    state.results = [...partial];
  })
    .then((results) => {
      state.results = results;
      state.checkedAt = Date.now();
      const bad = results.filter((r) => r.status === "error").map((r) => `${r.title}: ${r.message}`);
      logEngine(bad.length ? "warn" : "info", bad.length ? `Selbsttest: ${bad.length} Fehler – ${bad.join(" | ")}` : "Selbsttest: alles in Ordnung");
      return results;
    })
    .finally(() => {
      state.checking = false;
      checkPromise = null;
    });
  return checkPromise;
}

export async function runRepair(id: RepairId): Promise<void> {
  if (state.task) throw new Error(`Es läuft schon: ${state.task.title}`);
  state.task = { repair: id, title: repairTitle(id), message: "Startet …", startedAt: Date.now() };
  state.lastError = null;
  try {
    await runRepairAction(id, (message, fraction) => {
      if (state.task) state.task = { ...state.task, message, fraction };
    });
  } catch (err) {
    state.lastError = describeError(err).message;
    logEngine("error", `Reparatur fehlgeschlagen: ${repairTitle(id)}`, err);
    throw err;
  } finally {
    state.task = null;
    void runSelftest();
  }
}

// Reparaturen, die ohne Rückfrage laufen dürfen; WSL braucht Admin und den Nutzer
const AUTO_REPAIRS: RepairId[] = ["import-distro", "provision", "start-docker", "pull-images", "start-services", "docling-models", "pull-model", "apply-tts-engines"];

// Beim Start: prüfen und so weit wie möglich selbst reparieren
export async function autoStart(): Promise<void> {
  if (!IS_WINDOWS || process.env.PM_ENGINE_AUTOSTART === "0") {
    await runSelftest();
    return;
  }
  state.autoStart = "läuft";
  for (let round = 0; round < AUTO_REPAIRS.length + 1; round++) {
    const results = await runSelftest();
    if (results.find((r) => r.id === "distro" && r.status === "ok")) startKeepAlive();
    const next = results.find((r) => r.status !== "ok" && r.repair && AUTO_REPAIRS.includes(r.repair));
    if (!next?.repair) break;
    try {
      await runRepair(next.repair);
    } catch {
      state.autoStart = "braucht-hilfe";
      return;
    }
  }
  const remaining = state.results.filter((r) => r.status === "error");
  state.autoStart = remaining.length ? "braucht-hilfe" : "fertig";
}

// WSL beendet leere Umgebungen nach kurzer Zeit: offenen Prozess halten
let keepAlive: ChildProcess | null = null;
let keepAliveStopped = false;

export function startKeepAlive(): void {
  if (!IS_WINDOWS || keepAlive || keepAliveStopped) return;
  keepAlive = spawn("wsl.exe", ["-d", DISTRO, "-u", "root", "--", "sleep", "infinity"], { windowsHide: true, stdio: "ignore" });
  logEngine("info", "Wachhalter für die Engine-Umgebung gestartet");
  keepAlive.on("exit", (code) => {
    keepAlive = null;
    if (keepAliveStopped) return;
    logEngine("warn", `Wachhalter beendet (Code ${code}), Neustart in 10 s`);
    setTimeout(startKeepAlive, 10_000);
  });
}

export function stopKeepAlive(): void {
  keepAliveStopped = true;
  keepAlive?.kill();
}

registerDiagnostic("selbsttest", () => ({
  geprüft: state.checkedAt ? new Date(state.checkedAt).toISOString() : null,
  autoStart: state.autoStart,
  letzterFehler: state.lastError,
  ergebnisse: state.results,
}));

process.on("exit", stopKeepAlive);
