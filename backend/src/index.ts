import "./log/boot";
import { DATA_DIR, LOG_DIR } from "./paths";
import { APP_VERSION } from "./version";
import { startupHeader, startupStep, startupDone, startupNote } from "./log/startup";
import { requestLogger, onRouteError } from "./log/http";
import { logRoutes, clientLogRoutes } from "./routes/logs";
import { registerDiagnostic } from "./log/diagnostics";
import { publicConfig } from "./services/llmConfig";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { authMiddleware, authRoutes } from "./auth";
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
import { initDb } from "./db";

// Laufende Pumpen für Sidecar- und Container-Logs
import {
  startSidecarLogPump,
  startDockerLogPumps,
} from "./services/logTap";
startSidecarLogPump();
// Docling-Logs über pm-docker-log-bridge, ohne URL ohne Wirkung
startDockerLogPumps();

startupHeader(APP_VERSION, {
  Daten: DATA_DIR,
  Logs: LOG_DIR,
  Arbeitsordner: process.cwd(),
  Werkzeuge: Object.fromEntries(
    ["ffmpeg", "ffprobe", "pdftoppm", "tesseract", "AtomicParsley"].map((t) => [t, Bun.which(t) ?? "FEHLT"])
  ),
});

// Zusätzliche Inhalte fürs Diagnosepaket
registerDiagnostic("einstellungen", () => publicConfig());
registerDiagnostic("werkzeuge", () =>
  Object.fromEntries(["ffmpeg", "ffprobe", "pdftoppm", "tesseract", "AtomicParsley"].map((t) => [t, Bun.which(t)]))
);

const app = new Hono();

app.use("/*", cors());
app.use("/*", requestLogger);
app.onError(onRouteError);

// Public
app.get("/api/health", (c) => c.json({ status: "ok", version: APP_VERSION }));
app.route("/api/auth", authRoutes);
app.route("/api/logs/client", clientLogRoutes);

// Protected
app.use("/api/*", authMiddleware);
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

// Static frontend (production)
app.use("/*", serveStatic({ root: "./public" }));
app.use("/*", serveStatic({ path: "./public/index.html" }));

await startupStep("Datenbank öffnen", () => initDb());
await startupStep("Suchindex prüfen", () => ensureSearchReady());
startupNote(`Dienste laut Einstellungen: ${JSON.stringify(serviceUrls())}`);

export default {
  port: 3000,
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

startupNote(`API läuft auf Port 3000, Version ${APP_VERSION}`);
startupDone();

// Konfigurierte Dienst-Adressen, ohne Schlüssel
function serviceUrls(): Record<string, unknown> {
  const cfg = publicConfig() as Record<string, unknown>;
  return Object.fromEntries(Object.entries(cfg).filter(([k, v]) => /url/i.test(k) && v));
}
