import { Hono } from "hono";
import {
  listChatSessions,
  createChatSession,
  getChatSession,
  deleteChatSession,
  renameChatSession,
  listChatMessages,
  ask,
} from "../services/tutor";

export const tutorRoutes = new Hono();

tutorRoutes.get("/sessions", (c) => {
  return c.json({ sessions: listChatSessions() });
});

tutorRoutes.post("/sessions", async (c) => {
  const body = await c.req
    .json<{ moduleId?: string | null }>()
    .catch(() => ({}) as { moduleId?: string | null });
  const moduleId = body?.moduleId ?? null;
  const session = createChatSession(moduleId);
  return c.json({ session }, 201);
});

tutorRoutes.get("/sessions/:id", (c) => {
  const id = c.req.param("id");
  const session = getChatSession(id);
  if (!session) return c.json({ error: "session not found" }, 404);
  const messages = listChatMessages(id);
  return c.json({ session, messages });
});

tutorRoutes.patch("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ title?: string }>();
  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return c.json({ error: "title required" }, 400);
  }
  const ok = renameChatSession(id, body.title);
  if (!ok) return c.json({ error: "session not found" }, 404);
  return c.json({ status: "ok" });
});

tutorRoutes.delete("/sessions/:id", (c) => {
  const id = c.req.param("id");
  const ok = deleteChatSession(id);
  if (!ok) return c.json({ error: "session not found" }, 404);
  return c.json({ status: "ok" });
});

tutorRoutes.post("/sessions/:id/messages", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ question?: string }>();
  const question = (body.question ?? "").trim();
  if (!question) return c.json({ error: "question required" }, 400);
  try {
    const answer = await ask({ sessionId: id, question });
    return c.json({ answer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "session_not_found") {
      return c.json({ error: "session not found" }, 404);
    }
    if (msg === "embedder_unreachable") {
      return c.json(
        { error: "Embedding-Server (TEI) nicht erreichbar." },
        503
      );
    }
    if (msg === "no_chunks_in_scope") {
      return c.json(
        {
          error:
            "Keine indexierten Inhalte im gewählten Modul gefunden. Hast du Dokumente hochgeladen und Re-Embed angestoßen?",
        },
        400
      );
    }
    console.error("[tutor] ask failed:", err);
    return c.json({ error: msg }, 500);
  }
});
