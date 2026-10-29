import "./log/boot";
import { DATA_DIR, LOG_DIR, PUBLIC_DIR } from "./paths";
import { syncVectors, vecState } from "./services/rag/vec";
import { APP_VERSION } from "./version";
import { toolStatus } from "./tools";
import { startupHeader, startupStep, startupDone, startupNote } from "./log/startup";
import { requestLogger, onRouteError } from "./log/http";
import { logRoutes, clientLogRoutes } from "./routes/logs";
import { studyRoutes } from "./routes/study";
import { knowledgeRoutes, startQueue, watchImportFolder } from "./routes/knowledge";
import { cloudRoutes } from "./routes/cloud";
import { engineRoutes } from "./routes/engine";
import { autoStart } from "./engine/manager";
import { alreadyRunning, appWindowHandle, openUi, quitApp } from "./launch";
import { registerDiagnostic } from "./log/diagnostics";
import { publicConfig } from "./services/llmConfig";
import { Hono } from "hono";
import { join } from "path";
import { serveStatic } from "hono/bun";
import { localOnly, authRoutes } from "./auth";
import { documentRoutes } from "./routes/documents";
import { chapterRoutes } from "./routes/chapters";
import { audioRoutes } from "./routes/audio";
import { cardRoutes } from "./routes/cards";
import { examRoutes } from "./routes/exam";
import { searchRoutes } from "./routes/search";
import { summaryRoutes } from "./routes/summaries";
import { dashboardRoutes } from "./routes/dashboard";
import { llmConfigRoutes } from "./routes/llmConfig";
import { tutorRoutes } from "./routes/tutor";
import { moduleRoutes } from "./routes/modules";
import { ragRoutes } from "./routes/rag";
import { voiceRoutes } from "./routes/voices";
import { adminRoutes } from "./routes/admin";
import { ensureReady as ensureSearchReady } from "./services/search";
import { db, initDb } from "./db";
import { migrateTtsEngines } from "./engine/extraEngines";
import { seedBuiltinVoices } from "./services/builtinVoices";

// Laufende Pumpen für Sidecar- und Container-Logs
import {
  startSidecarLogPump,
} from "./services/logTap";
startSidecarLogPump();

startupHeader(APP_VERSION, {
  Daten: DATA_DIR,
  Logs: LOG_DIR,
  Arbeitsordner: process.cwd(),
  Werkzeuge: toolStatus(),
});

// Zusätzliche Inhalte fürs Diagnosepaket
registerDiagnostic("einstellungen", () => publicConfig());
registerDiagnostic("werkzeuge", () => toolStatus());

// Nur lokal erreichbar; PM_HOST=0.0.0.0 z. B. für Docker
const HOST = process.env.PM_HOST || "127.0.0.1";
const PORT = Number(process.env.PM_PORT_INTERNAL || process.env.PORT || 3100);
const APP_URL = `http://127.0.0.1:${PORT}`;

// Zweiter Start: vorhandenes Fenster nach vorne holen und beenden
if (await alreadyRunning(APP_URL)) {
  startupNote("PageMentor läuft schon, zeige das vorhandene Fenster");
  process.exit(0);
}

const app = new Hono();

app.use("/*", localOnly);
app.use("/*", requestLogger);
app.onError(onRouteError);

// Public
app.get("/api/health", (c) => c.json({ status: "ok", version: APP_VERSION }));
app.route("/api/auth", authRoutes);
app.route("/api/logs/client", clientLogRoutes);

app.route("/api/documents", documentRoutes);
app.route("/api/chapters", chapterRoutes);
app.route("/api/audio", audioRoutes);
app.route("/api/cards", cardRoutes);
app.route("/api/exam", examRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/summary", summaryRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/llm/config", llmConfigRoutes);
app.route("/api/modules", moduleRoutes);
app.route("/api/rag", ragRoutes);
app.route("/api/voices", voiceRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/tutor", tutorRoutes);
app.route("/api/logs", logRoutes);
app.route("/api/engine", engineRoutes);
app.route("/api/study", studyRoutes);
app.route("/api/knowledge", knowledgeRoutes);
app.route("/api/cloud", cloudRoutes);
// Für den zweiten Start: Fenster der laufenden Instanz
app.get("/api/app/window", (c) => c.json({ hwnd: appWindowHandle() }));
app.post("/api/app/quit", (c) => {
  quitApp("über die Oberfläche");
  return c.json({ ok: true });
});

// Static frontend (production)
app.use("/*", serveStatic({ root: PUBLIC_DIR }));
app.use("/*", serveStatic({ path: join(PUBLIC_DIR, "index.html") }));

await startupStep("Datenbank öffnen", () => initDb());
migrateTtsEngines();
await startupStep("Suchindex prüfen", () => ensureSearchReady());
startupNote(vecState.available ? `Vektorsuche: sqlite-vec (${vecState.path})` : `Vektorsuche: langsamer Weg in JS (${vecState.error})`);
// Vektorindex einmalig nachziehen, ohne den Start zu blockieren
setTimeout(() => {
  try {
    const r = syncVectors(db());
    if (r.added || r.removed || r.moved) startupNote(`Vektorindex: ${r.added} neu, ${r.removed} entfernt, ${r.moved} umgehängt`);
  } catch (err) {
    startupNote(`Vektorindex nicht aktualisiert: ${err instanceof Error ? err.message : err}`);
  }
  // Unterbrochenen Stapel-Import fortsetzen
  startQueue();
  watchImportFolder();
  // Vorlage-Stimmen für F5-TTS und TADA, einmalig
  void seedBuiltinVoices();
}, 2000);
startupNote(`Dienste laut Einstellungen: ${JSON.stringify(serviceUrls())}`);

export default {
  port: PORT,
  hostname: HOST,
  fetch: app.fetch,
  // Bun's default idleTimeout of 10 s kills audio range fetches and
  // LLM streaming. 255 s was long enough until M4B rebuilds came in —
  // a large book re-encode (14+ chapters, 130 min audio → AAC) can
  // run 5-10 min CPU-bound without sending bytes to the client,
  // and Bun would close the request mid-flight.
  // 0 = no timeout (per Bun docs). Makes the backend robust against
  // slow long-polling / encode paths. LLM streaming and ranges
  // are active streams and don't need the timer anyway.
  idleTimeout: 0,
};

startupNote(`API läuft auf http://${HOST}:${PORT}, Version ${APP_VERSION}`);
startupDone();
openUi(APP_URL);

// Engine im Hintergrund prüfen und starten, blockiert die App nicht
void autoStart().catch((err) => console.error("[engine] Autostart fehlgeschlagen", err));

// Konfigurierte Dienst-Adressen, ohne Schlüssel
function serviceUrls(): Record<string, unknown> {
  const cfg = publicConfig() as Record<string, unknown>;
  return Object.fromEntries(Object.entries(cfg).filter(([k, v]) => /url/i.test(k) && v));
}
