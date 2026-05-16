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
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Version resolver: primarily from the VERSION file (repo root, single
// source of truth), fallback to package.json. VERSION lands in the
// Docker image at /app/VERSION (see Dockerfile). In local dev the
// file is two levels above src/index.ts.
const PKG_VERSION = ((): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "VERSION"), // dev: backend/src → repo/VERSION
    join(here, "..", "VERSION"),       // docker: /app/src → /app/VERSION
  ];
  for (const path of candidates) {
    try {
      const v = readFileSync(path, "utf-8").trim();
      if (v.length > 0) return v;
    } catch {
      // try next
    }
  }
  try {
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf-8")
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// Timestamp prefix for all console.* output. The Docker log driver
// already prefixes lines in Portainer, but anyone pulling logs via
// `docker logs` without -t or parsing them from a text file gets
// bare lines without time context — and comparing multiple container
// logs becomes painful. An additional ISO timestamp at the line
// start also helps a frontend log view (if we ever build one).
(() => {
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const origInfo = console.info.bind(console);
  const ts = (): string => new Date().toISOString();
  console.log = (...args: unknown[]) => origLog(`[${ts()}]`, ...args);
  console.info = (...args: unknown[]) => origInfo(`[${ts()}]`, ...args);
  console.warn = (...args: unknown[]) => origWarn(`[${ts()}] WARN`, ...args);
  console.error = (...args: unknown[]) => origError(`[${ts()}] ERROR`, ...args);
})();

// Wire console.* into the in-memory log bus BEFORE the banner so
// even the first lines after boot show up in the Logs page.
import { installLogTap, startSidecarLogPump } from "./services/logTap";
installLogTap();
startSidecarLogPump();

// Loud startup banner — makes it immediately visible in the
// Portainer log that the new build is actually running (Portainer
// often shows container recreates without a clear signal, even
// when they went through silently).
console.log("================================================================");
console.log(`  PageMentor backend v${PKG_VERSION}`);
console.log(`  started at ${new Date().toISOString()}`);
console.log(`  node_env=${process.env.NODE_ENV ?? "development"} data_dir=${process.env.PM_DATA_DIR ?? "./data"}`);
console.log("================================================================");

const app = new Hono();

app.use("/*", cors());

// Public
app.get("/api/health", (c) => c.json({ status: "ok", version: PKG_VERSION }));
app.route("/api/auth", authRoutes);

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

// Static frontend (production)
app.use("/*", serveStatic({ root: "./public" }));
app.use("/*", serveStatic({ path: "./public/index.html" }));

initDb();
ensureSearchReady();

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

console.log(`PageMentor API v${PKG_VERSION} running on :3000`);
