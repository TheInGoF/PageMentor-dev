// Gemma-Anweisungen und Aussprache-Liste: lesen, eigene Fassung speichern, auf das Original zurücksetzen
import { Hono } from "hono";
import { PROMPTS, isPromptId, promptInfo, resetPrompt, savePrompt } from "../services/prompts";
import { suggestFor, suggestFromDocument } from "../services/pronunciationSuggest";
import { DEFAULT_PRONUNCIATION, pronunciationList, resetPronunciation, savePronunciation, type PronunciationEntry } from "../services/pronunciation";

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

export const pronunciationRoutes = new Hono();

pronunciationRoutes.get("/", (c) => c.json({ ...pronunciationList(), defaults: DEFAULT_PRONUNCIATION }));

pronunciationRoutes.put("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { entries?: PronunciationEntry[] };
  savePronunciation(body.entries ?? []);
  return c.json({ ...pronunciationList(), defaults: DEFAULT_PRONUNCIATION });
});

pronunciationRoutes.delete("/", (c) => {
  resetPronunciation();
  return c.json({ ...pronunciationList(), defaults: DEFAULT_PRONUNCIATION });
});

// Gemma-Vorschläge: für Wörter oder aus einem Heft; die App fügt sie ungeprüft an
pronunciationRoutes.post("/suggest", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { words?: string[]; docId?: string; model?: string };
  try {
    const items = body.docId ? await suggestFromDocument(body.docId, body.model) : await suggestFor(body.words ?? [], body.model);
    return c.json({ items });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
  }
});
