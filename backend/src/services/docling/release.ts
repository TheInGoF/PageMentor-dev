// Docling hält seine Modelle nach dem ersten Auftrag im Grafikspeicher (mit Bildbeschreibung und
// Diagrammen rund 14 GB) und gibt ihn nie frei. Der Arbiter verwaltet Docling nicht, darum startet
// die App den Container nach einer Ruhepause neu; Qwen und Ollama bekommen den Speicher zurück.
import { setTimeout as sleep } from "timers/promises";
import { IS_WINDOWS } from "../../paths";
import { DOCLING_CONTAINER } from "../../engine/config";
import { inDistro } from "../../engine/exec";
import { emitLog } from "../../log/logger";
import { doclingAlive } from "./client";
import { DOCLING_URL } from "./types";

// Ruhepause nach dem letzten Auftrag; im Stapel-Import liegen dazwischen Kapitel, Embeddings und KI
export const RELEASE_AFTER_MS = 3 * 60_000;

let busy = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let restarting: Promise<void> | null = null;

// Nur die eigene Engine unter Windows; ein entfernter Docling-Server bleibt unangetastet
function managed(): boolean {
  return IS_WINDOWS && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(DOCLING_URL);
}

async function release(): Promise<void> {
  emitLog("info", "docling", "Docling ruht, Neustart gibt den Grafikspeicher frei");
  const r = await inDistro(`docker restart ${DOCLING_CONTAINER}`, { timeoutMs: 180_000, quiet: true });
  if (r.code !== 0) {
    emitLog("warn", "docling", "Docling-Neustart fehlgeschlagen", { ctx: { stderr: r.stderr.slice(0, 300) } });
    return;
  }
  // Bereit, wenn /health antwortet; Standardmodelle lädt Docling beim Start
  for (let i = 0; i < 60 && !(await doclingAlive()); i++) await sleep(2000);
}

// Jeder Docling-Auftrag läuft hier durch: wartet einen laufenden Neustart ab, danach beginnt die Ruhepause neu
export async function withDocling<T>(fn: () => Promise<T>): Promise<T> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (restarting) await restarting;
  busy++;
  try {
    return await fn();
  } finally {
    busy--;
    if (busy === 0 && managed()) {
      timer = setTimeout(() => {
        timer = null;
        if (busy > 0) return;
        restarting = release()
          .catch((err) => emitLog("warn", "docling", "Docling-Neustart fehlgeschlagen", { err }))
          .finally(() => (restarting = null));
      }, RELEASE_AFTER_MS);
      timer.unref?.();
    }
  }
}

// Vor anderer GPU-Arbeit (z. B. Hörbuch-Lauf): Speicher gleich freigeben statt die Ruhepause abzuwarten
export async function releaseDoclingNow(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (restarting) return restarting;
  if (busy > 0 || !managed()) return;
  restarting = release()
    .catch((err) => emitLog("warn", "docling", "Docling-Neustart fehlgeschlagen", { err }))
    .finally(() => (restarting = null));
  return restarting;
}
