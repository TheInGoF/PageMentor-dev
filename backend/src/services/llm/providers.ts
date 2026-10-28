// LLM-Anbieter mit Fallback-Kette, erster erreichbarer gewinnt
// Reihenfolge: Ollama PC → Mac → allgemein → Claude → OpenAI → Gemini
// Ergebnis 30 s gecacht; ohne Anbieter sind nur die KI-Funktionen aus
import OpenAI from "openai";
import { effective } from "../llmConfig";
import { pingOllama, isEmbeddingModel } from "./ollama";

export type ProviderType = "ollama" | "anthropic" | "openai" | "google" | "none";

export interface Provider {
  type: ProviderType;
  label: string;
  url?: string;
  apiKey?: string;
  model: string;
}

function buildCandidates(): Provider[] {
  // Leeres Ollama-Modell: erstes vorhandenes nehmen, siehe resolveOllamaModel
  const defaultOllama = effective("ollamaModel", "PM_OLLAMA_MODEL") || "";
  const defaultClaude =
    effective("anthropicModel", "PM_ANTHROPIC_MODEL") ||
    "claude-haiku-4-5-20251001";
  const out: Provider[] = [];

  const urlPc = effective("ollamaUrlPc", "PM_OLLAMA_URL_PC");
  if (urlPc) {
    out.push({
      type: "ollama",
      label: "Ollama · PC (NVIDIA)",
      url: urlPc,
      model: defaultOllama,
    });
  }
  const urlMac = effective("ollamaUrlMac", "PM_OLLAMA_URL_MAC");
  if (urlMac) {
    out.push({
      type: "ollama",
      label: "Ollama · Mac (Apple Silicon)",
      url: urlMac,
      model: defaultOllama,
    });
  }
  const urlGeneric = effective("ollamaUrl", "PM_OLLAMA_URL");
  if (urlGeneric) {
    out.push({
      type: "ollama",
      label: "Ollama",
      url: urlGeneric,
      model: defaultOllama,
    });
  }
  const claudeKey = effective("anthropicApiKey", "PM_ANTHROPIC_API_KEY");
  if (claudeKey) {
    out.push({
      type: "anthropic",
      label: "Claude API",
      apiKey: claudeKey,
      model: defaultClaude,
    });
  }
  const openaiKey = effective("openaiApiKey", "PM_OPENAI_API_KEY");
  if (openaiKey) {
    out.push({
      type: "openai",
      label: "OpenAI · ChatGPT",
      apiKey: openaiKey,
      model: effective("openaiModel", "PM_OPENAI_MODEL") || "gpt-4o-mini",
    });
  }
  const googleKey = effective("googleApiKey", "PM_GOOGLE_API_KEY");
  if (googleKey) {
    out.push({
      type: "google",
      label: "Google · Gemini",
      apiKey: googleKey,
      model: effective("googleModel", "PM_GOOGLE_MODEL") || "gemini-2.0-flash",
    });
  }
  return out;
}

// Cache leeren nach Config-Änderung
export function reloadCandidates(): void {
  cached = { provider: null, checkedAt: 0 };
}

const CACHE_MS = 30_000;
// Kein Anbieter erreichbar: nur kurz merken, sonst scheitern alle folgenden Kapitel wegen eines Aussetzers
const MISS_CACHE_MS = 3_000;

let cached: { provider: Provider | null; checkedAt: number } = {
  provider: null,
  checkedAt: 0,
};


export async function pickProvider(force = false): Promise<Provider | null> {
  if (!force && Date.now() - cached.checkedAt < (cached.provider ? CACHE_MS : MISS_CACHE_MS)) {
    return cached.provider;
  }
  for (const c of buildCandidates()) {
    let ok = false;
    if (c.type === "ollama" && c.url) ok = await pingOllama(c.url);
    else if ((c.type === "anthropic" || c.type === "openai" || c.type === "google") && c.apiKey) ok = true;
    if (ok) {
      cached = { provider: c, checkedAt: Date.now() };
      return c;
    }
  }
  cached = { provider: null, checkedAt: Date.now() };
  return null;
}

export async function isAvailable(): Promise<boolean> {
  return (await pickProvider()) !== null;
}

export interface LlmStatus {
  available: boolean;
  url: string;              // Ollama URL or provider label; never null.
  defaultModel: string;     // "" when nothing is configured.
  models: string[];
  providerType: ProviderType | null;
  label: string;
  candidates: Array<{ label: string; type: ProviderType; url: string }>;
}

export async function llmStatus(): Promise<LlmStatus> {
  const p = await pickProvider();
  return {
    available: !!p,
    url: p?.type === "ollama" ? p.url ?? "" : p?.label ?? "",
    defaultModel: p?.model ?? "",
    models: await listModels(),
    providerType: p?.type ?? null,
    label: p?.label ?? "",
    candidates: buildCandidates().map((c) => ({
      label: c.label,
      type: c.type,
      url: c.url ?? "",
    })),
  };
}

export async function listModels(): Promise<string[]> {
  const p = await pickProvider();
  if (!p) return [];
  if (p.type === "ollama" && p.url) {
    try {
      const res = await fetch(`${p.url}/api/tags`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      // Embedding-Modelle ausblenden
      return (data.models ?? [])
        .map((m) => m.name)
        .filter((n) => !isEmbeddingModel(n));
    } catch {
      return [];
    }
  }
  if (p.type === "anthropic") {
    return [
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
      "claude-opus-4-7",
    ];
  }
  if (p.type === "openai" && p.apiKey) {
    try {
      const client = new OpenAI({ apiKey: p.apiKey });
      const res = await client.models.list();
      return res.data
        .map((m) => m.id)
        .filter((id) => id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3"))
        .sort();
    } catch {
      return ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"];
    }
  }
  if (p.type === "google") {
    return [
      "gemini-2.0-flash",
      "gemini-2.0-flash-exp",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
    ];
  }
  return [];
}
