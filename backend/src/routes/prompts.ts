// Gemma-Anweisungen lesen, eigene Fassung speichern, aufs Original zurücksetzen
import { Hono } from "hono";
import { PROMPTS, isPromptId, promptInfo, resetPrompt, savePrompt } from "../services/prompts";

export const promptRoutes = new Hono();

promptRoutes.get("/", (c) => c.json({ prompts: (Object.keys(PROMPTS) as Array<keyof typeof PROMPTS>).map(promptInfo) }));

promptRoutes.put("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isPromptId(id)) return c.json({ error: "unbekannt" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  if (!body.text?.trim()) return c.json({ error: "Text fehlt" }, 400);
  savePrompt(id, body.text);
  return c.json(promptInfo(id));
});

promptRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  if (!isPromptId(id)) return c.json({ error: "unbekannt" }, 404);
  resetPrompt(id);
  return c.json(promptInfo(id));
});
