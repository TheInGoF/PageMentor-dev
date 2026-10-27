import { Hono } from "hono";
import { allVoices, findVoice, defaultVoiceFor } from "../../tts/voices";
import { synthesizePreview } from "../../tts/synth";
import { tt } from "../../lib/i18n";

export const voiceRoutes = new Hono();

// Stimmenkatalog, standardmäßig nur showInAudiobook=true
// ?showHidden=1 für die Settings: auch ausgeblendete
voiceRoutes.get("/voices", (c) => {
  const showHidden = c.req.query("showHidden") === "1";
  return c.json({ voices: allVoices(showHidden) });
});

// Kurze Hörprobe der Stimme
// Optional text und instruct für den Preset-Tester, dann ohne Cache
voiceRoutes.get("/preview", async (c) => {
  const voiceId = c.req.query("voice") || "";
  const voice = findVoice(voiceId);
  if (!voice) return c.json({ error: tt(c, "err.invalidVoice") }, 400);

  const textOverride = c.req.query("text");
  const instructOverride = c.req.query("instruct");
  const tempOverride = c.req.query("temperature");
  const topPOverride = c.req.query("top_p");
  const topKOverride = c.req.query("top_k");
  const repPenOverride = c.req.query("repetition_penalty");
  const hasOverrides =
    textOverride !== undefined ||
    instructOverride !== undefined ||
    tempOverride !== undefined ||
    topPOverride !== undefined ||
    topKOverride !== undefined ||
    repPenOverride !== undefined;

  // Längerer Probetext: Qwen driftet erst nach ~5 s, wie im Hörbuch
  const sample = textOverride
    ? textOverride
    : voice.language === "de"
    ? "Willkommen bei PageMentor. So klingt dein Hörbuch. Der Text geht bewusst über mehrere Sätze, damit Sie einschätzen können, wie die Stimme über einen längeren Absatz hinweg klingt. Gerade bei einem Hörbuch kommt es darauf an, dass die Aussprache stabil bleibt und der Klangcharakter sich nicht mitten im Absatz verändert."
    : "Welcome to PageMentor. This is how your audiobook will sound. The text deliberately spans several sentences so you can judge how this voice sounds across a longer passage. Audiobook listening depends on the voice staying stable without shifting character mid-paragraph.";

  const parseOptFloat = (s: string | undefined): number | undefined => {
    if (s === undefined || s === "") return undefined;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const parseOptInt = (s: string | undefined): number | undefined => {
    if (s === undefined || s === "") return undefined;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  try {
    const buf = await synthesizePreview({
      voice: voiceId,
      locale: voice.locale,
      text: sample,
      instructOverride,
      temperatureOverride: parseOptFloat(tempOverride),
      topPOverride: parseOptFloat(topPOverride),
      topKOverride: parseOptInt(topKOverride),
      repetitionPenaltyOverride: parseOptFloat(repPenOverride),
    });
    // ArrayBuffer: passt für Bun- und Node-Typen
    const body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": hasOverrides ? "no-store" : "public, max-age=86400",
      },
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : tt(c, "err.ttsFailed") }, 500);
  }
});
