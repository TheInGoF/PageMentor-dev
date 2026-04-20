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
import { moduleRoutes } from "./routes/modules";
import { ragRoutes } from "./routes/rag";
import { voiceRoutes } from "./routes/voices";
import { adminRoutes } from "./routes/admin";
import { ensureReady as ensureSearchReady } from "./services/search";
import { initDb } from "./db";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Version-Resolver: primär aus VERSION-Datei (Repo-Root, Single Source
// of Truth), fallback auf package.json. VERSION landet im Docker-Image
// unter /app/VERSION (siehe Dockerfile). Im lokalen Dev-Betrieb ist
// die Datei zwei Ebenen über src/index.ts.
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

// Auffälliger Startup-Banner — macht im Portainer-Log sofort sichtbar
// dass der neue Build auch wirklich läuft (Portainer zeigt Container-
// Recreates oft ohne klares Signal, auch wenn's still durchging).
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

// Static frontend (production)
app.use("/*", serveStatic({ root: "./public" }));
app.use("/*", serveStatic({ path: "./public/index.html" }));

initDb();
ensureSearchReady();

export default {
  port: 3000,
  fetch: app.fetch,
  // Bun's default idleTimeout of 10 s kills audio range fetches and LLM
  // summary streams. 255 s is Bun's documented maximum — enough, because
  // the idle timer resets on every chunk and LLM streaming emits tokens
  // far more frequently than that.
  idleTimeout: 255,
};

console.log(`PageMentor API v${PKG_VERSION} running on :3000`);
