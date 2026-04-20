import { Hono } from "hono";
import { getLlmConfig, publicConfig, setLlmConfig } from "../services/llmConfig";
import { llmStatus, reloadCandidates } from "../services/llm";

export const llmConfigRoutes = new Hono();

llmConfigRoutes.get("/", async (c) => {
  return c.json({
    config: publicConfig(),
    status: await llmStatus(),
  });
});

llmConfigRoutes.put("/", async (c) => {
  const body = await c.req.json<{
    ollamaUrlPc?: string;
    ollamaUrlMac?: string;
    ollamaUrl?: string;
    ollamaModel?: string;
    anthropicApiKey?: string;
    anthropicModel?: string;
    openaiApiKey?: string;
    openaiModel?: string;
    googleApiKey?: string;
    googleModel?: string;
    qwenTtsUrl?: string;
    qwenTtsApiKey?: string;
    qwenTtsInstruction?: string;
    qwenTtsTemperature?: string;
    qwenTtsTopP?: string;
    qwenTtsMaxNewTokens?: string;
    qwenTtsSeedOverride?: string;
  }>();

  // Only overwrite an API key when the client sends a non-empty string.
  // Empty / undefined means "keep what's stored".
  const patch = { ...body };
  for (const keyField of [
    "anthropicApiKey",
    "openaiApiKey",
    "googleApiKey",
    "qwenTtsApiKey",
  ] as const) {
    const v = patch[keyField];
    if (v === undefined || v === "" || v === "•••") {
      delete patch[keyField];
    }
  }

  setLlmConfig(patch);
  reloadCandidates();
  return c.json({
    config: publicConfig(),
    status: await llmStatus(),
  });
});

llmConfigRoutes.delete("/:provider", (c) => {
  const provider = c.req.param("provider");
  const patch: Record<string, string> = {};
  if (provider === "anthropic") patch.anthropicApiKey = "";
  else if (provider === "openai") patch.openaiApiKey = "";
  else if (provider === "google") patch.googleApiKey = "";
  else if (provider === "qwenTts") patch.qwenTtsApiKey = "";
  else return c.json({ error: "Unknown provider" }, 400);
  setLlmConfig(patch);
  reloadCandidates();
  return c.json({ config: publicConfig() });
});

// Avoid "unused import" in production build — exported for completeness.
void getLlmConfig;
