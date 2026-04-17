/**
 * LLM abstraction with a priority fallback chain.
 *
 * Providers are tried in this order — the first one that answers a
 * health check is used for all generate/stream calls until the cache
 * expires (30 s). If none is reachable, the relevant API endpoints
 * respond with `err.ollamaUnavailable` and the UI shows the
 * "not configured" hint.
 *
 *   1. PM_OLLAMA_URL_PC         — your beefy workstation (NVIDIA)
 *   2. PM_OLLAMA_URL_MAC        — Apple-Silicon Mac, Metal-accelerated
 *   3. PM_OLLAMA_URL            — generic Ollama (NAS, same-host …)
 *   4. PM_ANTHROPIC_API_KEY     — paid fallback via Claude API
 *   (none)                      — AI tabs disabled, rest of the app works
 */

import Anthropic from "@anthropic-ai/sdk";
import { effective } from "./llmConfig";

export type ProviderType = "ollama" | "anthropic" | "none";

export interface Provider {
  type: ProviderType;
  label: string;
  url?: string;
  apiKey?: string;
  model: string;
}

function buildCandidates(): Provider[] {
  const defaultOllama =
    effective("ollamaModel", "PM_OLLAMA_MODEL") || "llama3.1:8b";
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
  const apiKey = effective("anthropicApiKey", "PM_ANTHROPIC_API_KEY");
  if (apiKey) {
    out.push({
      type: "anthropic",
      label: "Claude API",
      apiKey,
      model: defaultClaude,
    });
  }
  return out;
}

/** Invalidate the cached candidates after a config change. */
export function reloadCandidates(): void {
  cached = { provider: null, checkedAt: 0 };
}

const CACHE_MS = 30_000;

let cached: { provider: Provider | null; checkedAt: number } = {
  provider: null,
  checkedAt: 0,
};

async function pingOllama(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pickProvider(force = false): Promise<Provider | null> {
  if (!force && Date.now() - cached.checkedAt < CACHE_MS) {
    return cached.provider;
  }
  for (const c of buildCandidates()) {
    let ok = false;
    if (c.type === "ollama" && c.url) ok = await pingOllama(c.url);
    else if (c.type === "anthropic" && c.apiKey) ok = true;
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
      return (data.models ?? []).map((m) => m.name);
    } catch {
      return [];
    }
  }
  if (p.type === "anthropic") {
    // Anthropic's API doesn't expose a /models list; hard-code the
    // current family (cheapest first).
    return [
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
      "claude-opus-4-7",
    ];
  }
  return [];
}

export interface GenerateResult {
  response: string;
  model: string;
  provider: string;
  totalMs: number;
}

export async function generate(params: {
  prompt: string;
  system?: string;
  model?: string;
  options?: Record<string, unknown>;
}): Promise<GenerateResult> {
  const p = await pickProvider();
  if (!p) throw new Error("No LLM provider configured");
  const started = Date.now();
  const model = params.model || p.model;

  if (p.type === "ollama" && p.url) {
    const res = await fetch(`${p.url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: params.prompt,
        system: params.system,
        stream: false,
        options: { temperature: 0.3, top_p: 0.9, ...params.options },
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as { response?: string; model?: string };
    return {
      response: (data.response ?? "").trim(),
      model: data.model ?? model,
      provider: p.label,
      totalMs: Date.now() - started,
    };
  }

  if (p.type === "anthropic" && p.apiKey) {
    const client = new Anthropic({ apiKey: p.apiKey });
    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      system: params.system,
      messages: [{ role: "user", content: params.prompt }],
    });
    const text = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    return {
      response: text,
      model: resp.model,
      provider: p.label,
      totalMs: Date.now() - started,
    };
  }

  throw new Error("No LLM provider available");
}

export async function generateStream(params: {
  prompt: string;
  system?: string;
  model?: string;
  options?: Record<string, unknown>;
  onToken: (chunk: string) => void;
  onDone?: (full: string, model: string) => void;
}): Promise<{ full: string; model: string }> {
  const p = await pickProvider();
  if (!p) throw new Error("No LLM provider configured");
  const model = params.model || p.model;

  if (p.type === "ollama" && p.url) {
    const res = await fetch(`${p.url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: params.prompt,
        system: params.system,
        stream: true,
        options: { temperature: 0.3, top_p: 0.9, ...params.options },
      }),
    });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama ${res.status}: ${txt.slice(0, 200)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    let actualModel = model;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line) as {
            response?: string;
            model?: string;
          };
          if (json.model) actualModel = json.model;
          if (json.response) {
            full += json.response;
            params.onToken(json.response);
          }
        } catch {
          /* malformed line, skip */
        }
      }
    }
    if (params.onDone) params.onDone(full, actualModel);
    return { full: full.trim(), model: actualModel };
  }

  if (p.type === "anthropic" && p.apiKey) {
    const client = new Anthropic({ apiKey: p.apiKey });
    let full = "";
    let finalModel = model;
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system: params.system,
      messages: [{ role: "user", content: params.prompt }],
    });
    stream.on("text", (text: string) => {
      full += text;
      params.onToken(text);
    });
    const msg = await stream.finalMessage();
    finalModel = msg.model;
    if (params.onDone) params.onDone(full, finalModel);
    return { full: full.trim(), model: finalModel };
  }

  throw new Error("No LLM provider available");
}

