// Text erzeugen, einmalig oder gestreamt
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { pickProvider } from "./providers";
import { resolveOllamaModel } from "./ollama";

export interface GenerateResult {
  response: string;
  model: string;
  provider: string;
  totalMs: number;
  // Stop-Grund, bei Ollama done_reason: stop, length, load
  doneReason?: string;
  // Erzeugte Tokens, bisher nur Ollama
  outputTokens?: number;
  // Token der Anfrage (System, Prompt), bisher nur Ollama: zeigt, wie voll der Kontext ist
  promptTokens?: number;
}

export async function generate(params: {
  prompt: string;
  system?: string;
  model?: string;
  options?: Record<string, unknown>;
  // JSON-Schema: Ollama erzwingt die Struktur grammatisch, andere Anbieter bekommen es als Hinweis
  format?: Record<string, unknown>;
  // Denkmodus von Modellen wie Qwen 3.6: false antwortet direkt (schneller), ohne Angabe gilt der Standard des Modells
  think?: boolean;
}): Promise<GenerateResult> {
  const p = await pickProvider();
  if (!p) throw new Error("No LLM provider configured");
  const started = Date.now();
  let model = params.model || p.model;
  if (params.format && p.type !== "ollama") {
    params = { ...params, system: `${params.system ?? ""}\n\nAntworte nur mit JSON nach diesem Schema:\n${JSON.stringify(params.format)}` };
  }

  if (p.type === "ollama" && p.url) {
    model = await resolveOllamaModel(p.url, model);
    // 15 min Timeout: sonst hängt ein Hörbuch-Lauf ewig
    const res = await fetch(`${p.url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: params.prompt,
        system: params.system,
        stream: false,
        ...(params.format ? { format: params.format } : {}),
        ...(params.think !== undefined ? { think: params.think } : {}),
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
      promptTokens: data.prompt_eval_count,
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
