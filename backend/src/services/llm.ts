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
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { effective } from "./llmConfig";

export type ProviderType = "ollama" | "anthropic" | "openai" | "google" | "none";

export interface Provider {
  type: ProviderType;
  label: string;
  url?: string;
  apiKey?: string;
  model: string;
}

function buildCandidates(): Provider[] {
  // For Ollama endpoints, an empty default means "auto-pick the first
  // model pulled on that server". The concrete resolve happens per
  // call in resolveOllamaModel().
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

/** Query an Ollama server for the models it actually has pulled. */
async function ollamaTags(url: string): Promise<string[]> {
  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/** Embedding-only models must NOT be picked as a generation default —
 *  Ollama then throws 400 "does not support generate". Matching is
 *  string-based because Ollama tags don't report task capability. */
const EMBEDDING_MODEL_PATTERNS = [
  /(^|[\/_-])embed/i,        // nomic-embed-text, mxbai-embed-large, …
  /(^|[\/_-])minilm/i,       // all-minilm
  /^bge[-_]/i,               // bge-* family
];

function isEmbeddingModel(name: string): boolean {
  return EMBEDDING_MODEL_PATTERNS.some((re) => re.test(name));
}

/**
 * Resolve the model name for an Ollama call:
 *  - if a specific name is requested and the server has it, use it
 *  - if requested AND missing AND we can pull, attempt /api/pull and
 *    surface a clear error if that fails (no silent fallback to "any
 *    other model the arbiter has loaded")
 *  - if NOTHING was requested, pick the first available NON-EMBEDDING
 *    model as a soft default (caller didn't care which one)
 *
 * The "no silent fallback" rule fixes a real bug: when the GPU arbiter
 * had qwen3.5:9b loaded for a different caller, every Card-Build chunk
 * silently switched to qwen and ran into qwen's token-limit problem.
 * The user expected gemma3:e4b (per their Settings) and got nothing.
 */
async function resolveOllamaModel(
  url: string,
  requested: string | undefined
): Promise<string> {
  const available = await ollamaTags(url);
  if (requested && available.includes(requested)) {
    console.log(`[llm] using requested model "${requested}" (matched in /api/tags at ${url})`);
    return requested;
  }

  if (requested) {
    // Try a pull — Ollama will fetch the model if it's available
    // upstream. This handles "I configured gemma3:e4b in Settings but
    // it's not pulled yet" cleanly. Pull is synchronous-ish: we wait
    // up to 5 min for the stream to close. Most models are <10 GB and
    // arrive within that window on a normal home connection.
    console.log(
      `[llm] requested model "${requested}" not in Ollama /api/tags at ${url}; ` +
        `attempting /api/pull (one-time, may take minutes)`
    );
    const pulled = await tryPullOllamaModel(url, requested);
    if (pulled) {
      console.log(`[llm] pull of "${requested}" succeeded`);
      return requested;
    }
    // Hard error — don't switch to a different model behind the user's
    // back. Caller can catch this and decide what to do.
    const generative = available.filter((n) => !isEmbeddingModel(n));
    throw new Error(
      `Requested Ollama model "${requested}" is not available at ${url} ` +
        `and /api/pull failed. Models present: [${generative.join(", ") || "(none)"}]. ` +
        `Either pull the model manually (\`ollama pull ${requested}\`) or pick a different ` +
        `Default Ollama Model in Settings.`
    );
  }

  // No model requested — log this LOUDLY so the user notices that
  // Settings → Default Ollama Model is empty. Then pick the first
  // generative one as a soft default.
  const generative = available.filter((n) => !isEmbeddingModel(n));
  if (generative.length > 0) {
    console.warn(
      `[llm] no model pinned (Settings → Default Ollama Model is empty), ` +
        `auto-picked "${generative[0]}" from /api/tags at ${url}. ` +
        `Available generative models: [${generative.join(", ")}]. ` +
        `Set the field to suppress this warning.`
    );
    return generative[0];
  }

  console.warn(
    `[llm] no generative models found at ${url}; falling back to "llama3.2:3b"`
  );
  return "llama3.2:3b";
}

async function tryPullOllamaModel(url: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name, stream: false }),
      // 5 min hard timeout — small models can take longer than the
      // default 2 s. If you're pulling a 20 GB model on a slow link
      // you're going to have to do it manually.
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[llm] /api/pull for "${name}" failed:`, err);
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
      // Filter out embedding models — the user can't sensibly pick
      // them in the LLM model selector (summaries, cards, audio
      // preprocess); otherwise 400 "does not support generate".
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

export interface GenerateResult {
  response: string;
  model: string;
  provider: string;
  totalMs: number;
  /** Why the model stopped, if the provider tells us. For Ollama this
   *  is `done_reason` ("stop" = clean EOS, "length" = hit num_predict,
   *  "load" = model still loading, undefined = older Ollama). Used by
   *  callers to surface a helpful error instead of a bare "empty
   *  response". */
  doneReason?: string;
  /** Number of tokens generated by the model (only set for Ollama
   *  today). Helps distinguish "model bailed immediately" from "model
   *  hit the predict limit". */
  outputTokens?: number;
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
  let model = params.model || p.model;

  if (p.type === "ollama" && p.url) {
    model = await resolveOllamaModel(p.url, model);
    // 15 min hard timeout. Without it Node's fetch waits forever —
    // if Ollama hangs because of too-large context or a model
    // switch gets stuck, the whole audiobook run freezes.
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
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      response?: string;
      model?: string;
      done?: boolean;
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const response = (data.response ?? "").trim();
    if (response.length === 0) {
      console.warn(
        `[llm] Ollama returned empty response (model=${data.model ?? model}, ` +
          `done=${data.done}, reason=${data.done_reason ?? "?"}, ` +
          `prompt_tokens=${data.prompt_eval_count ?? "?"}, ` +
          `output_tokens=${data.eval_count ?? 0})`
      );
    }
    return {
      response,
      model: data.model ?? model,
      provider: p.label,
      totalMs: Date.now() - started,
      doneReason: data.done_reason,
      outputTokens: data.eval_count,
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

  if (p.type === "openai" && p.apiKey) {
    const client = new OpenAI({ apiKey: p.apiKey });
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 4096,
      temperature: 0.3,
      messages: [
        ...(params.system ? [{ role: "system" as const, content: params.system }] : []),
        { role: "user" as const, content: params.prompt },
      ],
    });
    const text = resp.choices[0]?.message?.content?.trim() ?? "";
    return {
      response: text,
      model: resp.model,
      provider: p.label,
      totalMs: Date.now() - started,
    };
  }

  if (p.type === "google" && p.apiKey) {
    const genai = new GoogleGenerativeAI(p.apiKey);
    const gmodel = genai.getGenerativeModel({
      model,
      systemInstruction: params.system,
    });
    const resp = await gmodel.generateContent(params.prompt);
    const text = resp.response.text().trim();
    return {
      response: text,
      model,
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
  let model = params.model || p.model;

  if (p.type === "ollama" && p.url) {
    model = await resolveOllamaModel(p.url, model);
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

  if (p.type === "openai" && p.apiKey) {
    const client = new OpenAI({ apiKey: p.apiKey });
    const stream = await client.chat.completions.create({
      model,
      stream: true,
      max_tokens: 4096,
      temperature: 0.3,
      messages: [
        ...(params.system ? [{ role: "system" as const, content: params.system }] : []),
        { role: "user" as const, content: params.prompt },
      ],
    });
    let full = "";
    let finalModel = model;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        full += delta;
        params.onToken(delta);
      }
      if (chunk.model) finalModel = chunk.model;
    }
    if (params.onDone) params.onDone(full, finalModel);
    return { full: full.trim(), model: finalModel };
  }

  if (p.type === "google" && p.apiKey) {
    const genai = new GoogleGenerativeAI(p.apiKey);
    const gmodel = genai.getGenerativeModel({
      model,
      systemInstruction: params.system,
    });
    const result = await gmodel.generateContentStream(params.prompt);
    let full = "";
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        full += text;
        params.onToken(text);
      }
    }
    if (params.onDone) params.onDone(full, model);
    return { full: full.trim(), model };
  }

  throw new Error("No LLM provider available");
}

