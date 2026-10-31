// API: eigene Stimmen und Voice-Designs
import { request } from "./request";
import type {
  CustomVoiceMeta,
  VoiceDesignMeta,
  PresetVisibility,
} from "./types";

export const voicesApi = {
  customVoices: {
    list: () =>
      request<{ voices: CustomVoiceMeta[] }>("/api/voices/custom"),
    upload: (input: {
      label: string;
      gender: "female" | "male";
      language?: string;
      refText?: string;
      file: File;
    }) => {
      const form = new FormData();
      form.append("label", input.label);
      form.append("gender", input.gender);
      if (input.language) form.append("language", input.language);
      if (input.refText) form.append("refText", input.refText);
      form.append("file", input.file, input.file.name);
      return request<{ voice: CustomVoiceMeta }>("/api/voices/custom", {
        method: "POST",
        body: form,
      });
    },
    remove: (id: string) =>
      request<{ ok: true }>(`/api/voices/custom/${id}`, { method: "DELETE" }),
    previewUrl: (id: string, text?: string) =>
      `/api/voices/custom/${id}/preview${text ? `?text=${encodeURIComponent(text)}` : ""}`,
    setVisibility: (id: string, showInAudiobook: boolean) =>
      request<{ ok: true; showInAudiobook: boolean }>(
        `/api/voices/custom/${id}/visibility`,
        {
          method: "PATCH",
          body: JSON.stringify({ showInAudiobook }),
        }
      ),
    // Felder ändern; Audio und Seed bleiben
    update: (
      id: string,
      patch: {
        label?: string;
        gender?: "female" | "male";
        language?: string;
        refText?: string | null;
        instruct?: string | null;
      }
    ) =>
      request<{ ok: true; sample: CustomVoiceMeta }>(
        `/api/voices/custom/${id}`,
        { method: "PATCH", body: JSON.stringify(patch) }
      ),
  },
  voiceDesigns: {
    list: () => request<{ voices: VoiceDesignMeta[] }>("/api/voices/design"),
    // Design-Stimme anlegen; refBlob = gehörte Vorschau als Referenz
    // Ohne refBlob erzeugt der Server eine, die anders klingen kann
    create: (input: {
      label: string;
      gender: "female" | "male";
      language?: string;
      description: string;
      seed?: number;
      refBlob?: Blob;
      refText?: string;
    }) => {
      const form = new FormData();
      form.append("label", input.label);
      form.append("gender", input.gender);
      if (input.language) form.append("language", input.language);
      form.append("description", input.description);
      if (input.seed !== undefined) form.append("seed", String(input.seed));
      if (input.refBlob) form.append("ref_blob", input.refBlob, "preview.mp3");
      if (input.refText) form.append("ref_text", input.refText);
      return request<{ voice: VoiceDesignMeta }>("/api/voices/design", {
        method: "POST",
        body: form,
      });
    },
    remove: (id: string) =>
      request<{ ok: true }>(`/api/voices/design/${id}`, { method: "DELETE" }),
    // Referenz-Audio neu erzeugen; Seed, Beschreibung, Geschlecht bleiben
    regenerateReference: (id: string) =>
      request<{ ok: true; hasReference: boolean; refTextLength: number }>(
        `/api/voices/design/${id}/regenerate-reference`,
        { method: "POST" }
      ),
    setVisibility: (id: string, showInAudiobook: boolean) =>
      request<{ ok: true; showInAudiobook: boolean }>(
        `/api/voices/design/${id}/visibility`,
        {
          method: "PATCH",
          body: JSON.stringify({ showInAudiobook }),
        }
      ),
    // Felder ändern; Seed und Referenz bleiben
    update: (
      id: string,
      patch: {
        label?: string;
        gender?: "female" | "male";
        language?: string;
        description?: string;
      }
    ) =>
      request<{ ok: true; design: VoiceDesignMeta }>(
        `/api/voices/design/${id}`,
        { method: "PATCH", body: JSON.stringify(patch) }
      ),
    listPresetVisibility: () =>
      request<{ presets: PresetVisibility[] }>(
        "/api/voices/presets/visibility"
      ),
    setPresetVisibility: (visible: string[]) =>
      request<{ ok: true; visible: string[]; hidden: string[] }>(
        "/api/voices/presets/visibility",
        {
          method: "PUT",
          body: JSON.stringify({ visible }),
        }
      ),
    previewUrl: (id: string, text?: string) =>
      `/api/voices/design/${id}/preview${text ? `?text=${encodeURIComponent(text)}` : ""}`,
    // Vorschau ohne Speichern: MP3 + Seed aus Header X-Voice-Seed
    previewUnsaved: async (input: {
      description: string;
      gender: "female" | "male";
      language: "de" | "en" | "es";
      seed?: number;
      text?: string;
    }): Promise<{ blob: Blob; seed: number }> => {
      const res = await fetch("/api/voices/design/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText);
        throw new Error(`Preview ${res.status}: ${t.slice(0, 200)}`);
      }
      const seedHeader = res.headers.get("X-Voice-Seed");
      const seed = seedHeader ? parseInt(seedHeader, 10) : 0;
      const blob = await res.blob();
      return { blob, seed };
    },
  },
};
