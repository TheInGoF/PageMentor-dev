// Cloud-KI (Claude, OpenAI) nur auf ausdrücklichen Wunsch; Schlüssel aus den Einstellungen
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { effective } from "../llmConfig";
import { profileValue } from "../../study/progress";

export type CloudProvider = "anthropic" | "openai";

export interface CloudTarget {
  provider: CloudProvider;
  model: string;
  label: string;
}

// Claude Opus 5.5 als Standard für die Cloud-Hilfe; eigenes Modell über PM_CLOUD_CLAUDE_MODEL
const CLAUDE_MODEL = process.env.PM_CLOUD_CLAUDE_MODEL || "claude-opus-5-5";

export function cloudEnabled(): boolean {
  return profileValue("cloud_enabled") === "1";
}

export function cloudTargets(): CloudTarget[] {
  const out: CloudTarget[] = [];
  if (effective("anthropicApiKey", "PM_ANTHROPIC_API_KEY")) out.push({ provider: "anthropic", model: CLAUDE_MODEL, label: "Claude" });
  const openaiModel = effective("openaiModel", "PM_OPENAI_MODEL");
  if (effective("openaiApiKey", "PM_OPENAI_API_KEY")) out.push({ provider: "openai", model: openaiModel || "gpt-4o-mini", label: "OpenAI" });
  return out;
}

export class CloudRefusal extends Error {}

export async function cloudGenerate(target: CloudTarget, system: string, text: string): Promise<string> {
  if (target.provider === "anthropic") {
    const client = new Anthropic({ apiKey: effective("anthropicApiKey", "PM_ANTHROPIC_API_KEY") });
    // Lange Eingaben: gestreamt, damit keine Zeitüberschreitung droht.
    // fallbacks "default": lehnt das Modell aus Sicherheitsgründen ab, springt serverseitig ein passendes Modell ein
    // (Parameter ist im SDK 0.90 noch nicht typisiert, wird aber unverändert gesendet)
    const params = {
      model: target.model,
      max_tokens: 16000,
      system,
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: text }],
    } as unknown as Parameters<typeof client.beta.messages.stream>[0];
    const msg = await client.beta.messages.stream(params).finalMessage();
    if (msg.stop_reason === "refusal") throw new CloudRefusal("Die Cloud-KI hat die Anfrage abgelehnt");
    return msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  }
  const client = new OpenAI({ apiKey: effective("openaiApiKey", "PM_OPENAI_API_KEY") });
  const resp = await client.chat.completions.create({
    model: target.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: text },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() ?? "";
}
