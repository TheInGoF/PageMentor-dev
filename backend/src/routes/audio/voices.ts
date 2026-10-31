import { Hono } from "hono";
import { padMp3 } from "../../tts/ffmpeg";
import { allVoices, defaultVoiceFor, findVoice, setVoicePrefs, voicePrefs, type VoicePrefs } from "../../tts/voices";
import { synthesizePreview } from "../../tts/synth";
import { tt } from "../../lib/i18n";

export const voiceRoutes = new Hono();

// Stimmenkatalog, standardmäßig nur showInAudiobook=true
// ?showHidden=1 für die Settings: auch ausgeblendete
voiceRoutes.get("/voices", (c) => {
  const showHidden = c.req.query("showHidden") === "1";
  return c.json({ voices: allVoices(showHidden) });
});

// Standardstimmen je Sprache und Stimmlage; effective zeigt, welche Stimme ohne eigene Wahl greift
const PREF_LANGS = ["de", "en", "es"];
const prefsBody = () => ({
  ...voicePrefs(),
  effective: Object.fromEntries(PREF_LANGS.map((l) => [l, defaultVoiceFor(l)])),
});
voiceRoutes.get("/voice-defaults", (c) => c.json(prefsBody()));
voiceRoutes.put("/voice-defaults", async (c) => {
  const body = await c.req.json<Partial<VoicePrefs>>();
  setVoicePrefs({
    gender: body.gender === "female" || body.gender === "male" || body.gender === "" ? body.gender : undefined,
    byLang: body.byLang && typeof body.byLang === "object" ? body.byLang : undefined,
  });
  return c.json(prefsBody());
});

// Probetext je Sprache: mehrere Sätze, damit man hört, ob die Stimme über einen Absatz stabil bleibt
const PREVIEW_TEXT: Record<string, string> = {
  de: "Willkommen bei PageMentor. So klingt dein Hörbuch. Der Text geht bewusst über mehrere Sätze, damit Sie einschätzen können, wie die Stimme über einen längeren Absatz hinweg klingt. Gerade bei einem Hörbuch kommt es darauf an, dass die Aussprache stabil bleibt und der Klangcharakter sich nicht mitten im Absatz verändert.",
  en: "Welcome to PageMentor. This is how your audiobook will sound. The text deliberately spans several sentences so you can judge how this voice sounds across a longer passage. Audiobook listening depends on the voice staying stable without shifting character mid-paragraph.",
  es: "Bienvenido a PageMentor. Así suena tu audiolibro. El texto tiene varias frases a propósito, para que puedas valorar cómo suena esta voz a lo largo de un párrafo. En un audiolibro es importante que la pronunciación sea estable y que la voz no cambie de carácter a mitad del texto.",
};

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
  const sample = textOverride || PREVIEW_TEXT[voice.language] || PREVIEW_TEXT.en;

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
    // pad=ms: Stille davor und danach, damit kurze Beispiele nicht abgeschnitten klingen
    const padMs = Math.min(3000, Math.max(0, Number(c.req.query("pad") ?? 0) || 0));
    const out = padMs ? await padMp3(Buffer.from(buf), padMs) : buf;
    // ArrayBuffer: passt für Bun- und Node-Typen
    const body = new Uint8Array(out.buffer, out.byteOffset, out.byteLength) as unknown as BodyInit;
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
