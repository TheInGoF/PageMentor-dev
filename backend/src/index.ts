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
import { feedApiRoutes, feedPublicRoutes } from "./routes/feed";
import { dashboardRoutes } from "./routes/dashboard";
import { llmConfigRoutes } from "./routes/llmConfig";
import { ensureReady as ensureSearchReady } from "./services/search";
import { initDb } from "./db";

const app = new Hono();

app.use("/*", cors());

// Public
app.get("/api/health", (c) => c.json({ status: "ok", version: "1.03.000" }));
app.route("/api/auth", authRoutes);
// Podcast-Feed liegt öffentlich (Token-Auth im Pfad), damit Apple
// Podcasts / Overcast ihn ohne Cookie ziehen können.
app.route("/feed", feedPublicRoutes);

// Protected
app.use("/api/*", authMiddleware);
app.route("/api/documents", documentRoutes);
app.route("/api/chapters", chapterRoutes);
app.route("/api/audio", audioRoutes);
app.route("/api/cards", cardRoutes);
app.route("/api/exam", examRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/summary", summaryRoutes);
app.route("/api/feed", feedApiRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/llm/config", llmConfigRoutes);

// Static frontend (production)
app.use("/*", serveStatic({ root: "./public" }));
app.use("/*", serveStatic({ path: "./public/index.html" }));

initDb();
ensureSearchReady();

export default {
  port: 3000,
  fetch: app.fetch,
};

console.log("PageMentor API running on :3000");
