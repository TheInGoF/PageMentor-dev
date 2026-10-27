// Logging einrichten: Datei, Konsole, Prozess-Fehler, ausgehende Aufrufe
import { subscribe } from "../services/logBus";
import { installConsoleTap } from "./consoleTap";
import { describeError } from "./errors";
import { installFetchTap } from "./fetchTap";
import { appendAppLine, cleanupOldLogs, writeCrash } from "./files";
import { emitLog } from "./logger";
import { registerEnvSecrets } from "./redact";

let installed = false;

export function installLogging(): void {
  if (installed) return;
  installed = true;
  registerEnvSecrets();
  // Alles vom Bus landet in der Tagesdatei, auch Sidecar-Zeilen
  subscribe(appendAppLine);
  installConsoleTap();
  installFetchTap();

  process.on("uncaughtException", (err) => {
    const file = writeCrash("uncaughtException", describeError(err));
    emitLog("error", "crash", `Unerwarteter Fehler, App läuft weiter (${file ?? "kein Crash-Bericht"})`, { err });
  });
  process.on("unhandledRejection", (reason) => {
    const file = writeCrash("unhandledRejection", describeError(reason));
    emitLog("error", "crash", `Unbehandeltes Promise, App läuft weiter (${file ?? "kein Crash-Bericht"})`, { err: reason });
  });

  const removed = cleanupOldLogs();
  if (removed > 0) emitLog("info", "startup", `${removed} alte Log-Dateien gelöscht`);
  // Täglich aufräumen bei Dauerbetrieb
  setInterval(() => cleanupOldLogs(), 6 * 3_600_000).unref?.();
}
