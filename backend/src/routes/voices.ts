// Eigene Stimmen und Voice-Designs für Qwen3-TTS

import { Hono } from "hono";
import { randomInt } from "node:crypto";
import {
  createVoiceSample,
  deleteVoiceSample,
  getVoiceSample,
  listVoiceSamples,
  setVoiceSampleVisibility,
  updateVoiceSample,
  type Gender,
  type VoiceSamplePatch,
} from "../services/voiceSamples";
import {
  createVoiceDesign,
  deleteVoiceDesign,
  getVoiceDesign,
  listVoiceDesigns,
  setVoiceDesignVisibility,
  updateVoiceDesign,
  type VoiceDesignPatch,
} from "../services/voiceDesigns";
import { writeFileSync } from "node:fs";
import { synthesizePreview } from "../tts/synth";
import { previewDesignUnsaved, ensureDesignReference } from "../tts/engines/qwen";
import { designRefPath, setDesignReference } from "../services/voiceDesigns";
import {
  listPresetVisibility,
  hiddenPresetIds,
} from "../services/audioVoiceVisibility";
import { setLlmConfig } from "../services/llmConfig";

export const voiceRoutes = new Hono();

// Standard-Probetext kurz, ~5-7 s: Qwen-Klon braucht 3-10 s Referenz
// Längere Texte kann man im Tester selbst eingeben
function defaultPreviewText(language: string): string {
  if (language === "de") {
    return "Hallo, dies ist eine Sprachprobe dieser Stimme. So klingt sie beim Vorlesen eines Textes.";
  }
  if (language === "es") {
    return "Hola, esta es una muestra de esta voz. Así suena cuando lee un texto en voz alta.";
  }
  return "Hello, this is a voice sample. This is how it sounds when reading a book.";
}

// Voice-Designs: per Text beschriebene Stimmen

// Vorschau ohne Speichern: Seed würfeln, MP3 + Seed im Header X-Voice-Seed
voiceRoutes.post("/design/preview", async (c) => {
  const body = await c.req.json<{
    description: string;
    gender?: Gender;
    language?: string;
    seed?: number;
    text?: string;
  }>();

  const description = (body.description ?? "").trim();
  if (description.length < 10) {
    return c.json({ error: "description too short (at least 10 characters)" }, 400);
  }
  const gender: Gender = body.gender === "male" ? "male" : "female";
  const language = body.language === "en" || body.language === "es" ? body.language : "de";
  const seed =
    body.seed && Number.isFinite(body.seed) && body.seed > 0
      ? Math.floor(body.seed)
      : randomInt(1, 2 ** 31 - 1);
  const text =
    (body.text ?? "").trim() || defaultPreviewText(language);

  try {
    const buf = await previewDesignUnsaved({
      text,
      description,
      gender,
      language,
      seed,
      timeoutMs: 3 * 60_000,
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buf.length),
        "X-Voice-Seed": String(seed),
        "Access-Control-Expose-Headers": "X-Voice-Seed",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

voiceRoutes.get("/design", (c) => {
  return c.json({
    voices: listVoiceDesigns().map((d) => ({
      id: d.id,
      label: d.label,
      gender: d.gender,
      language: d.language,
      description: d.description,
      seed: d.seed,
      createdAt: d.createdAt,
      msPerChar: d.msPerChar,
      samplesCount: d.samplesCount,
    })),
  });
});

// Design anlegen + Referenz-Audio speichern: "erst designen, dann klonen"
// multipart mit ref_blob: genau die gehörte Vorschau wird Referenz
// JSON ohne Audio: Server erzeugt neu, kann anders klingen
voiceRoutes.post("/design", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  let label = "";
  let gender: Gender = "female";
  let language = "de";
  let description = "";
  let seed: number | undefined;
  let refBlob: ArrayBuffer | null = null;
  let refText: string | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.parseBody({ all: false });
      label = String(form.label ?? "").trim();
      gender = String(form.gender ?? "female") === "male" ? "male" : "female";
      language = String(form.language ?? "de") || "de";
      description = String(form.description ?? "").trim();
      const seedRaw = form.seed ? String(form.seed) : "";
      if (seedRaw) {
        const n = parseInt(seedRaw, 10);
        if (Number.isFinite(n) && n > 0) seed = n;
      }
      refText = form.ref_text ? String(form.ref_text) : null;
      const blob = form.ref_blob;
      // Dateien kommen als File: instanceof prüfen, nicht duck-typen
      if (blob instanceof File) {
        refBlob = await blob.arrayBuffer();
      }
      console.log(
        `[voices] POST /design multipart received: label=${JSON.stringify(label)} ` +
          `desc_len=${description.length} seed=${seed ?? "auto"} gender=${gender} ` +
          `ref_blob=${
            blob instanceof File
              ? `${blob.size}B "${blob.name}" type=${blob.type}`
              : `MISSING (type=${typeof blob})`
          }`
      );
    } else {
      const body = await c.req.json<{
        label: string;
        gender?: Gender;
        language?: string;
        description: string;
        seed?: number;
      }>();
      label = body.label;
      gender = body.gender === "male" ? "male" : "female";
      language = body.language ?? "de";
      description = body.description;
      seed = body.seed;
    }
  } catch (e) {
    return c.json({ error: `bad request: ${(e as Error).message}` }, 400);
  }

  try {
    const { design } = createVoiceDesign({
      label,
      gender,
      language,
      description,
      seed,
    });

    // Referenz speichern: Upload bevorzugt, sonst serverseitig erzeugen
    let finalDesign = design;
    if (refBlob) {
      const path = designRefPath(design.id);
      writeFileSync(path, Buffer.from(refBlob));
      const effectiveRefText = refText || defaultPreviewText(language);
      setDesignReference(design.id, path, effectiveRefText);
      finalDesign = { ...design, refPath: path, refText: effectiveRefText };
      console.log(
        `[voices] design ${design.id} reference saved from upload: ${refBlob.byteLength}B → ${path}`
      );
    } else {
      // Fallback ohne Upload, dauert ~30-60 s
      try {
        finalDesign = await ensureDesignReference(design);
      } catch (e) {
        console.warn(
          `[voices] ensureDesignReference for ${design.id} failed:`,
          e
        );
        // Ohne Referenz weiter, Retry beim ersten Einsatz
      }
    }

    return c.json({
      voice: {
        id: finalDesign.id,
        label: finalDesign.label,
        gender: finalDesign.gender,
        language: finalDesign.language,
        description: finalDesign.description,
        seed: finalDesign.seed,
        createdAt: finalDesign.createdAt,
        msPerChar: finalDesign.msPerChar,
        samplesCount: finalDesign.samplesCount,
        hasReference: !!finalDesign.refPath,
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

voiceRoutes.delete("/design/:id", (c) => {
  const ok = deleteVoiceDesign(c.req.param("id"));
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// Referenz einer Design-Stimme neu erzeugen, z. B. nach längerem Referenztext
voiceRoutes.post("/design/:id/regenerate-reference", async (c) => {
  const id = c.req.param("id");
  const design = getVoiceDesign(id);
  if (!design) return c.json({ error: "not found" }, 404);
  try {
    const updated = await ensureDesignReference(design, 3 * 60_000, true);
    return c.json({
      ok: true,
      hasReference: !!updated.refPath,
      refTextLength: updated.refText?.length ?? 0,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

voiceRoutes.get("/design/:id/preview", async (c) => {
  const id = c.req.param("id");
  const design = getVoiceDesign(id);
  if (!design) return c.json({ error: "not found" }, 404);

  const text = c.req.query("text") || defaultPreviewText(design.language);

  try {
    const buf = await synthesizePreview({
      voice: `design:${id}`,
      locale: design.language === "de" ? "de-DE" : "en-US",
      text,
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buf.length),
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

voiceRoutes.get("/custom", (c) => {
  return c.json({
    voices: listVoiceSamples().map((v) => ({
      id: v.id,
      label: v.label,
      gender: v.gender,
      language: v.language,
      refText: v.refText,
      refTextPresent: !!v.refText,
      instruct: v.instruct,
      bytes: v.bytes,
      seed: v.seed,
      createdAt: v.createdAt,
      msPerChar: v.msPerChar,
      samplesCount: v.samplesCount,
      showInAudiobook: v.showInAudiobook,
    })),
  });
});

voiceRoutes.post("/custom", async (c) => {
  const form = await c.req.parseBody({ all: false });

  const label = String(form.label ?? "").trim();
  if (!label) return c.json({ error: "label required" }, 400);

  const genderRaw = String(form.gender ?? "female");
  const gender: Gender = genderRaw === "male" ? "male" : "female";

  const language = String(form.language ?? "de") || "de";
  const refText = form.refText ? String(form.refText) : undefined;

  const file = form.file;
  if (!(file instanceof File)) {
    return c.json({ error: "file (multipart field 'file') required" }, 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    return c.json({ error: `failed to read upload: ${(e as Error).message}` }, 400);
  }

  try {
    const { sample } = await createVoiceSample({
      label,
      gender,
      language,
      refText,
      filename: file.name,
      bytes,
    });
    return c.json({
      voice: {
        id: sample.id,
        label: sample.label,
        gender: sample.gender,
        language: sample.language,
        refTextPresent: !!sample.refText,
        bytes: sample.bytes,
        seed: sample.seed,
        createdAt: sample.createdAt,
        msPerChar: sample.msPerChar,
        samplesCount: sample.samplesCount,
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

voiceRoutes.delete("/custom/:id", (c) => {
  const ok = deleteVoiceSample(c.req.param("id"));
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// Sichtbarkeit im Hörbuch-Dropdown, Synthese geht auch für ausgeblendete
voiceRoutes.patch("/custom/:id/visibility", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ showInAudiobook?: boolean }>()
    .catch(() => ({} as { showInAudiobook?: boolean }));
  const show = body.showInAudiobook !== false;
  const ok = setVoiceSampleVisibility(id, show);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true, showInAudiobook: show });
});

voiceRoutes.patch("/design/:id/visibility", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ showInAudiobook?: boolean }>()
    .catch(() => ({} as { showInAudiobook?: boolean }));
  const show = body.showInAudiobook !== false;
  const ok = setVoiceDesignVisibility(id, show);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true, showInAudiobook: show });
});

// Text und Metadaten einer eigenen Stimme ändern; Audio und Seed bleiben
voiceRoutes.patch("/custom/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<VoiceSamplePatch>()
    .catch(() => ({} as VoiceSamplePatch));
  try {
    const updated = updateVoiceSample(id, body);
    if (!updated) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true, sample: updated });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "patch failed" },
      400
    );
  }
});

// Design-Felder ändern; Seed und Referenz bleiben
voiceRoutes.patch("/design/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<VoiceDesignPatch>()
    .catch(() => ({} as VoiceDesignPatch));
  try {
    const updated = updateVoiceDesign(id, body);
    if (!updated) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true, design: updated });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "patch failed" },
      400
    );
  }
});

voiceRoutes.get("/presets/visibility", (c) => {
  return c.json({ presets: listPresetVisibility() });
});

voiceRoutes.put("/presets/visibility", async (c) => {
  const body = await c.req
    .json<{ visible?: string[] }>()
    .catch(() => ({} as { visible?: string[] }));
  const visible = new Set(body.visible ?? []);
  // Ausgeblendet = alle Presets außerhalb von visible
  const allPresets = listPresetVisibility();
  const hidden = allPresets
    .filter((p) => !visible.has(p.voice.id))
    .map((p) => p.voice.id);
  setLlmConfig({ hiddenAudiobookPresets: hidden.join(",") });
  return c.json({ ok: true, hidden, visible: Array.from(visible) });
});

voiceRoutes.get("/custom/:id/preview", async (c) => {
  const id = c.req.param("id");
  const sample = getVoiceSample(id);
  if (!sample) return c.json({ error: "not found" }, 404);

  const text = c.req.query("text") || defaultPreviewText(sample.language);

  try {
    // custom:<uuid> lädt die Referenz direkt aus der DB
    const buf = await synthesizePreview({
      voice: `custom:${id}`,
      locale: sample.language === "de" ? "de-DE" : "en-US",
      text,
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buf.length),
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});
