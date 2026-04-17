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
  }>();

  // Preserve existing Anthropic key if the client sent an empty string as
  // a "no change" signal (UI masks the key with ••• and only overwrites
  // when the user explicitly types something).
  const patch = { ...body };
  if (patch.anthropicApiKey === undefined || patch.anthropicApiKey === "•••") {
    delete patch.anthropicApiKey;
  }

  setLlmConfig(patch);
  reloadCandidates();
  return c.json({
    config: publicConfig(),
    status: await llmStatus(),
  });
});

llmConfigRoutes.delete("/anthropic", (c) => {
  setLlmConfig({ anthropicApiKey: "" });
  reloadCandidates();
  return c.json({ config: publicConfig() });
});

// Avoid "unused import" in production build — exported for completeness.
void getLlmConfig;
