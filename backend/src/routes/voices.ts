/**
 * Voice sample routes — user uploads for Qwen3-TTS voice clone.
 *
 *   GET    /api/voices/custom            → list
 *   POST   /api/voices/custom            → upload (multipart)
 *   DELETE /api/voices/custom/:id        → remove
 *   GET    /api/voices/custom/:id/preview?text=…  → short preview (MP3)
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
import { writeFileSync } from "node:fs";
import { synthesizePreview } from "../tts/synth";
import { previewDesignUnsaved, ensureDesignReference } from "../tts/engines/qwen";
import { designRefPath, setDesignReference } from "../services/voiceDesigns";

export const voiceRoutes = new Hono();

/** Default preview text — deliberately **short** (~5-7 s audio @ 12Hz).
 *  Qwen-Base clone expects a reference of 3-10 s; longer audios
 *  confuse the model and produce gibberish synthesis ("backwards
 *  baby-speak" was one concrete user report with a ~25 s ref).
 *  voiceSamples enforces the same limit via MAX_BYTES for uploads.
 *
 *  Anyone wanting to hear Qwen's long-text drift can enter their own
 *  longer sample text in the tester's text field — the preview UI
 *  allows that. The default only matters for the stored ref audio file. */
function defaultPreviewText(language: string): string {
  if (language === "de") {
    return "Hallo, dies ist eine Sprachprobe dieser Stimme. So klingt sie beim Vorlesen eines Textes.";
  }
  return "Hello, this is a voice sample. This is how it sounds when reading a book.";
}

/* ------------------------------------------------------------------ */
/* Voice designs: text-described voices via Qwen3-TTS VoiceDesign.    */
/* ------------------------------------------------------------------ */

/** Unsaved preview for the design wizard: rolls a seed (or takes the
 *  one passed in) and returns MP3 + the seed via `X-Voice-Seed`
 *  header. Unlike `/design/:id/preview`, NOTHING is created in the DB
 *  here — the user can keep rolling until they like a voice, then POST
 *  /design with the remembered seed to persist. */
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
  const language = body.language === "en" ? "en" : "de";
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

/** Creates a voice design row AND persists the reference audio file
 *  that all future synthesis calls will use as the clone prompt
 *  (Qwen's official "Voice Design then Clone" pattern).
 *
 *  Two content types accepted:
 *
 *  - **multipart/form-data** (recommended): contains `ref_blob` = the
 *    audio bytes the user just heard and approved in the preview
 *    wizard. Backend stores the bytes 1:1 as reference — guarantees
 *    that the saved voice sounds EXACTLY like what the user previewed.
 *
 *  - **application/json** (fallback): no audio bytes. Backend then
 *    lazily calls `ensureDesignReference` (server-side regeneration
 *    via VoiceDesign). Risk: the regenerated voice may differ from the
 *    preview due to Qwen's non-determinism.
 */
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
      // Same pattern as the /custom route: multipart files arrive as
      // File instances (File extends Blob). We used to duck-type
      // here, which failed in practice → refBlob stayed null → silent
      // fall-through to server regen, which generates a different
      // voice. User: "preview clean, broken after save".
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

    // Persist the reference audio. Prefer the blob upload from the
    // client (exactly matches the user preview); otherwise generate
    // on the server.
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
      // Server-side generation. This is the fallback path (JSON
      // clients without a blob). Can take ~30-60 s.
      try {
        finalDesign = await ensureDesignReference(design);
      } catch (e) {
        console.warn(
          `[voices] ensureDesignReference for ${design.id} failed:`,
          e
        );
        // Row stays without ref_path — will be retried on first
        // synthesis use. We still report success to the client so
        // the UI can show the design voice and let the user delete it.
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

  const text = c.req.query("text") || defaultPreviewText(sample.language);

  try {
    // Preview ID convention: `custom:<uuid>` is recognized by the
    // qwen engine as a custom voice and the reference audio is
    // loaded from the DB on the fly.
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
