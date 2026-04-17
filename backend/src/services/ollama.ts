/**
 * Minimaler Ollama-Client (http://localhost:11434 by default).
 * Benutzt nur /api/generate und /api/tags. Wenn Ollama nicht erreichbar,
 * melden die Aufrufer das dem User, statt die App abstürzen zu lassen.
 */

const OLLAMA_URL = process.env.PM_OLLAMA_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.PM_OLLAMA_MODEL || "llama3.1:8b";

export function ollamaUrl(): string {
  return OLLAMA_URL;
}

export function ollamaDefaultModel(): string {
  return DEFAULT_MODEL;
}

export async function isAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface GenerateResult {
  response: string;
  model: string;
  totalMs: number;
}

export async function generate(params: {
  prompt: string;
  system?: string;
  model?: string;
  options?: Record<string, unknown>;
}): Promise<GenerateResult> {
  const model = params.model || DEFAULT_MODEL;
  const started = Date.now();
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: params.prompt,
      system: params.system,
      stream: false,
      options: {
        temperature: 0.3,
        top_p: 0.9,
        ...params.options,
      },
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
    totalMs: Date.now() - started,
  };
}

export async function generateStream(params: {
  prompt: string;
  system?: string;
  model?: string;
  options?: Record<string, unknown>;
  onToken: (chunk: string) => void;
  onDone?: (full: string, model: string) => void;
}): Promise<{ full: string; model: string }> {
  const model = params.model || DEFAULT_MODEL;
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
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
          done?: boolean;
          model?: string;
        };
        if (json.model) actualModel = json.model;
        if (typeof json.response === "string" && json.response.length > 0) {
          full += json.response;
          params.onToken(json.response);
        }
      } catch {
        // ignore malformed chunks (unlikely)
      }
    }
  }

  if (params.onDone) params.onDone(full, actualModel);
  return { full: full.trim(), model: actualModel };
}

export async function listModels(): Promise<Array<{ name: string; size: number }>> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string; size: number }> };
    return data.models ?? [];
  } catch {
    return [];
  }
}
