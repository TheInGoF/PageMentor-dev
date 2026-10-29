// API: LLM-Einstellungen, Admin, Audiobookshelf
import { request } from "./request";
import type {
  OllamaStatus,
} from "./types";

export const settingsApi = {
  llmConfig: {
    get: () =>
      request<{
        config: {
          ollamaUrlPc?: string;
          ollamaUrlMac?: string;
          ollamaUrl?: string;
          ollamaModel?: string;
          anthropicModel?: string;
          anthropicApiKeyPresent: boolean;
          openaiModel?: string;
          openaiApiKeyPresent: boolean;
          googleModel?: string;
          googleApiKeyPresent: boolean;
          qwenTtsUrl?: string;
          qwenTtsApiKeyPresent?: boolean;
          qwenTtsInstruction?: string;
          qwenTtsTemperature?: string;
          qwenTtsTopP?: string;
          qwenTtsTopK?: string;
          qwenTtsRepetitionPenalty?: string;
          ttsMaxChunk?: string;
          doclingCharts?: string;
          absEnabled?: string;
          absUrl?: string;
          absApiKeyPresent?: boolean;
          absLibraryId?: string;
        };
        status: OllamaStatus;
      }>("/api/llm/config"),
    put: (body: {
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
      qwenTtsTopK?: string;
      qwenTtsRepetitionPenalty?: string;
      ttsMaxChunk?: string;
      doclingCharts?: string;
      absEnabled?: string;
      absUrl?: string;
      absApiKey?: string;
      absLibraryId?: string;
    }) =>
      request<{ config: unknown; status: OllamaStatus }>("/api/llm/config", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    removeKey: (
      provider: "anthropic" | "openai" | "google" | "qwenTts" | "abs"
    ) =>
      request<{ config: unknown }>(`/api/llm/config/${provider}`, { method: "DELETE" }),
  },
  admin: {
    // Harter GPU-Reset: TTS stoppen, Ollama entladen
    gpuReset: () =>
      request<{ ok: true; result: Record<string, unknown> }>(
        "/api/admin/gpu/reset",
        { method: "POST" }
      ),
  },
  abs: {
    // Audiobookshelf erreichbar, Token gültig?
    test: () =>
      request<{
        ok: boolean;
        url?: string;
        username?: string;
        serverVersion?: string;
        message?: string;
      }>("/api/admin/abs/test"),
    // Bibliotheken fürs Dropdown
    libraries: () =>
      request<{
        libraries: Array<{ id: string; name: string; mediaType: string }>;
      }>("/api/admin/abs/libraries"),
    // Fertiges M4B hochladen
    upload: (docId: string) =>
      request<{
        ok: true;
        libraryItemId?: string;
        uploadedBytes: number;
        url?: string;
      }>(`/api/admin/abs/upload/${docId}`, { method: "POST" }),
  },
};
