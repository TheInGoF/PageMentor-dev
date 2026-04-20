/**
 * Voice-Sample-Routen — User-Uploads für Qwen3-TTS Voice-Clone.
 *
 *   GET    /api/voices/custom            → Liste
 *   POST   /api/voices/custom            → Upload (multipart)
 *   DELETE /api/voices/custom/:id        → Entfernen
 *   GET    /api/voices/custom/:id/preview?text=…  → Kurz-Preview (MP3)
 */

import { Hono } from "hono";
import { randomInt } from "node:crypto";
import {
  createVoiceSample,
  deleteVoiceSample,
  getVoiceSample,
  listVoiceSamples,
  type Gender,
} from "../services/voiceSamples";
import {
  createVoiceDesign,
  deleteVoiceDesign,
  getVoiceDesign,
  listVoiceDesigns,
} from "../services/voiceDesigns";
import { synthesizePreview } from "../tts/synth";
import { previewDesignUnsaved } from "../tts/engines/qwen";

export const voiceRoutes = new Hono();

/* ------------------------------------------------------------------ */
/* Voice-Designs: text-beschriebene Stimmen via Qwen3-TTS VoiceDesign. */
/* ------------------------------------------------------------------ */

/** Unsaved-Preview für den Design-Wizard: rollt Seed (oder nimmt den
 *  übergebenen) und liefert MP3 + den Seed via `X-Voice-Seed`-Header
 *  zurück. Anders als `/design/:id/preview` wird hier NICHTS in der DB
 *  angelegt — der User kann so lange rollen bis eine Stimme gefällt,
 *  dann POST /design mit dem gemerkten Seed zum endgültigen Speichern. */
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
    return c.json({ error: "description zu kurz (mindestens 10 Zeichen)" }, 400);
  }
  const gender: Gender = body.gender === "male" ? "male" : "female";
  const language = body.language === "en" ? "en" : "de";
  const seed =
    body.seed && Number.isFinite(body.seed) && body.seed > 0
      ? Math.floor(body.seed)
      : randomInt(1, 2 ** 31 - 1);
  const text =
    (body.text ?? "").trim() ||
    (language === "de"
      ? "Hallo, dies ist eine kurze Sprachprobe dieser Stimme."
      : "Hello, this is a short voice preview.");

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

voiceRoutes.post("/design", async (c) => {
  const body = await c.req.json<{
    label: string;
    gender?: Gender;
    language?: string;
    description: string;
    seed?: number;
  }>();

  try {
    const { design } = createVoiceDesign({
      label: body.label,
      gender: body.gender === "male" ? "male" : "female",
      language: body.language,
      description: body.description,
      seed: body.seed,
    });
    return c.json({
      voice: {
        id: design.id,
        label: design.label,
        gender: design.gender,
        language: design.language,
        description: design.description,
        seed: design.seed,
        createdAt: design.createdAt,
        msPerChar: design.msPerChar,
        samplesCount: design.samplesCount,
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

voiceRoutes.get("/design/:id/preview", async (c) => {
  const id = c.req.param("id");
  const design = getVoiceDesign(id);
  if (!design) return c.json({ error: "not found" }, 404);

  const text =
    c.req.query("text") ||
    (design.language === "de"
      ? "Hallo, dies ist eine kurze Sprachprobe dieser Stimme."
      : "Hello, this is a short voice preview.");

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
      refTextPresent: !!v.refText,
      bytes: v.bytes,
      seed: v.seed,
      createdAt: v.createdAt,
      msPerChar: v.msPerChar,
      samplesCount: v.samplesCount,
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
    const { sample } = createVoiceSample({
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

voiceRoutes.get("/custom/:id/preview", async (c) => {
  const id = c.req.param("id");
  const sample = getVoiceSample(id);
  if (!sample) return c.json({ error: "not found" }, 404);

  const text =
    c.req.query("text") ||
    (sample.language === "de"
      ? "Hallo, dies ist eine kurze Sprachprobe."
      : "Hello, this is a short voice preview.");

  try {
    // Preview-ID-Konvention: `custom:<uuid>` wird von der qwen-Engine
    // als Custom-Voice erkannt und die Referenz-Audio wird on-the-fly
    // aus der DB geladen.
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
