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
import { writeFileSync } from "node:fs";
import { synthesizePreview } from "../tts/synth";
import { previewDesignUnsaved, ensureDesignReference } from "../tts/engines/qwen";
import { designRefPath, setDesignReference } from "../services/voiceDesigns";

export const voiceRoutes = new Hono();

/** Repräsentativer Vorschau-Text (~380 Zeichen). Lang genug um Qwens
 *  autoregressiven Drift sichtbar zu machen — kurzer 50-Zeichen-Text
 *  klingt oft konsistent mit dem Instruction-Prompt, die Hörbuch-
 *  Chunks mit 1000-1500 Zeichen aber nicht. Gemeinsam genutzt von
 *  allen Preview-Endpoints (design saved/unsaved, custom voice). */
function defaultPreviewText(language: string): string {
  if (language === "de") {
    return "Hallo, dies ist eine Sprachprobe dieser Stimme. Der Text geht bewusst über mehrere Sätze, damit Sie einschätzen können, wie die Stimme über einen längeren Absatz hinweg klingt. Gerade bei einem Hörbuch kommt es darauf an, dass die Aussprache stabil bleibt und der Klangcharakter sich nicht mitten im Absatz verändert.";
  }
  return "Hello, this is a voice sample. The text deliberately spans several sentences so you can judge how this voice sounds across a longer passage. Audiobook listening depends on the voice staying stable without shifting character mid-paragraph.";
}

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

/** Legt eine Voice-Design-Row an UND persistiert die Referenz-Audio-
 *  Datei die in allen zukünftigen Synthese-Calls als Clone-Prompt
 *  verwendet wird (Qwens offizielles "Voice Design then Clone"-Pattern).
 *
 *  Zwei Content-Types akzeptiert:
 *
 *  - **multipart/form-data** (empfohlen): enthält `ref_blob` = die
 *    Audio-Bytes, die der User eben im Preview-Wizard gehört und
 *    gutgeheißen hat. Backend speichert die Bytes 1:1 als Referenz —
 *    garantiert, dass die gespeicherte Stimme EXAKT so klingt wie
 *    das was der User probe-gehört hat.
 *
 *  - **application/json** (Fallback): keine Audio-Bytes. Backend ruft
 *    dann lazily `ensureDesignReference` auf (serverseitige Neu-
 *    Generierung via VoiceDesign). Risiko: die regenerierte Stimme
 *    könnte wegen Qwens Non-Determinismus vom Preview abweichen.
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
      // Hono gibt Upload-Files unter Bun/Node als File-Objekt zurück
      // (File extends Blob). Duck-typing statt instanceof — vermeidet
      // Typ-Probleme wenn Node-Globals nicht verfügbar sind.
      if (
        blob &&
        typeof blob === "object" &&
        typeof (blob as { arrayBuffer?: unknown }).arrayBuffer === "function"
      ) {
        refBlob = await (blob as Blob).arrayBuffer();
      }
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

    // Referenz-Audio persistieren. Blob-Upload vom Client bevorzugen
    // (matched exakt den User-Preview), sonst serverseitig generieren.
    let finalDesign = design;
    if (refBlob) {
      const path = designRefPath(design.id);
      writeFileSync(path, Buffer.from(refBlob));
      const effectiveRefText =
        refText ||
        (language === "de"
          ? "Hallo, dies ist eine Sprachprobe. Der Text geht über mehrere Sätze, damit die Stimm-Charakteristik sichtbar wird."
          : "Hello, this is a voice sample. The text spans several sentences so the voice character becomes clear.");
      setDesignReference(design.id, path, effectiveRefText);
      finalDesign = { ...design, refPath: path, refText: effectiveRefText };
    } else {
      // Server-seitige Generierung. Das ist der Fallback-Pfad (JSON-
      // Clients ohne Blob). Kann ~30-60 s dauern.
      try {
        finalDesign = await ensureDesignReference(design);
      } catch (e) {
        console.warn(
          `[voices] ensureDesignReference for ${design.id} failed:`,
          e
        );
        // Row bleibt liegen ohne ref_path — beim ersten Synthese-Use
        // wird erneut versucht. Dem Client melden wir trotzdem Erfolg,
        // damit die UI die Design-Voice anzeigen und vom User löschen
        // lassen kann.
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
