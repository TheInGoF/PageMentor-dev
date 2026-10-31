// Engines Kokoro, F5 und TADA: gleicher HTTP-Vertrag, Weg über den Arbiter
// F5 und TADA klonen aus Stimmproben und Qwen-Designs, Kokoro hat Martin und Kerstin
import { readFileSync } from "fs";
import { unlink, writeFile } from "fs/promises";
import { getVoiceSample, listVoiceSamples, readVoiceRefBytes } from "../../../services/voiceSamples";
import { getVoiceDesign, listVoiceDesigns } from "../../../services/voiceDesigns";
import { applyAtempo } from "../../ffmpeg";
import type { PreviewParams, SynthesizeParams, SynthesizeResult, TtsEngine, Voice } from "../base";
import { authHeaders, parseRate, PREVIEW_TIMEOUT_MS, qwenLanguageFor, SYNTH_TIMEOUT_MS } from "../qwen/config";
import { ensureDesignReference } from "../qwen/designRef";
import { ttsFetch } from "../qwen/http";
import { EXTRA, KOKORO_VOICES, kokoroPackVoice, speechUrl, type ExtraId } from "./config";
import { extraAvailable, kokoroVoiceNames } from "./probe";

interface CloneRef {
  b64: string;
  text: string | null;
  seed: number;
}

const locale = (lang: string) => ({ de: "de-DE", en: "en-US", es: "es-ES" })[lang] ?? lang;

const F5_NOTES: Record<string, string> = {
  es: "F5-TTS Spanish · klont aus der Stimmprobe",
  en: "F5-TTS (Original, Englisch) · klont aus der Stimmprobe",
};

function listFor(id: ExtraId): Voice[] {
  const meta = EXTRA[id];
  if (!meta.clones) {
    const de = KOKORO_VOICES.map((v, i): Voice => ({ id: `${id}:${v.id}`, label: v.label, language: "de", locale: "de-DE", gender: v.gender, engine: id, flagship: i === 0, note: meta.note }));
    // Sprachpaket: erste Stimme je Sprache ist Standard
    const seen = new Set<string>();
    const pack = kokoroVoiceNames()
      .map(kokoroPackVoice)
      .filter((v): v is NonNullable<typeof v> => !!v)
      .map((v): Voice => {
        const flagship = !seen.has(v.language);
        seen.add(v.language);
        return { id: `${id}:${v.id}`, label: v.label, language: v.language, locale: v.locale, gender: v.gender, engine: id, flagship, note: `Kokoro-82M · ${v.langLabel}` };
      });
    return [...de, ...pack];
  }
  // TADA nur Deutsch; F5 hat je ein Modell für Deutsch, Spanisch und Englisch und wechselt je Sprache
  const langs = id === "f5" ? ["de", "es", "en"] : ["de"];
  const firstOfLang = new Set<string>();
  const samples = listVoiceSamples()
    .filter((s) => langs.includes(s.language))
    .map((s): Voice => ({
      id: `${id}:custom:${s.id}`,
      label: s.label,
      language: s.language,
      locale: locale(s.language),
      gender: s.gender,
      engine: id,
      flagship: !firstOfLang.has(s.language) && !!firstOfLang.add(s.language),
      note: `${id === "f5" ? F5_NOTES[s.language] ?? meta.note : meta.note}${s.refText ? "" : " · Transkript fehlt"}`,
      showInAudiobook: s.showInAudiobook,
    }));
  const designs = listVoiceDesigns()
    .filter((d) => langs.includes(d.language))
    .map((d): Voice => ({
      id: `${id}:design:${d.id}`,
      label: `${d.label} · Design`,
      language: d.language,
      locale: locale(d.language),
      gender: d.gender,
      engine: id,
      note: `${meta.note} · Referenz aus Qwen-Design`,
      showInAudiobook: d.showInAudiobook,
    }));
  return [...samples, ...designs];
}

async function cloneRef(id: ExtraId, voiceId: string, timeoutMs: number): Promise<CloneRef> {
  const rest = voiceId.slice(id.length + 1);
  if (rest.startsWith("custom:")) {
    const s = getVoiceSample(rest.slice("custom:".length));
    if (!s) throw new Error(`Stimmprobe ${voiceId} nicht gefunden`);
    return { b64: readVoiceRefBytes(s).toString("base64"), text: s.refText, seed: s.seed };
  }
  if (rest.startsWith("design:")) {
    const d = getVoiceDesign(rest.slice("design:".length));
    if (!d) throw new Error(`Design ${voiceId} nicht gefunden`);
    // Referenz einmalig über Qwen erzeugen, danach von der Platte
    const ready = await ensureDesignReference(d, timeoutMs);
    if (!ready.refPath) throw new Error(`Design ${voiceId} hat keine Referenz`);
    return { b64: readFileSync(ready.refPath).toString("base64"), text: ready.refText, seed: ready.seed };
  }
  throw new Error(`Unbekannte Stimme für ${EXTRA[id].label}: ${voiceId}`);
}

async function speak(id: ExtraId, voice: Voice, text: string, speed: number, timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
  const meta = EXTRA[id];
  const ref = meta.clones ? await cloneRef(id, voice.id, timeoutMs) : null;
  const res = await ttsFetch(speechUrl(id), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      input: text,
      voice: voice.id,
      response_format: "mp3",
      speed: meta.speed ? speed : 1.0,
      ref_audio_b64: ref?.b64,
      ref_text: ref?.text ?? undefined,
      language: qwenLanguageFor(voice.language),
      seed: ref?.seed ?? 0,
    }),
    timeoutMs,
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`${meta.label} ${res.status} (voice=${voice.id}): ${detail.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`${meta.label} returned empty audio for voice=${voice.id}`);
  return buf;
}

function createEngine(id: ExtraId): TtsEngine {
  const meta = EXTRA[id];
  return {
    id,
    isAvailable: () => extraAvailable(id),
    listVoices: () => {
      try {
        return listFor(id);
      } catch (err) {
        console.warn(`[${id}-tts] Stimmen nicht lesbar:`, err);
        return [];
      }
    },

    async synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
      const text = params.text || (params.announce ? `${params.announce}.\n\n` : "") + params.segment.paragraphs.join("\n\n");
      const speed = parseRate(params.rate);
      const t0 = Date.now();
      const buf = await speak(id, params.voice, text, speed, SYNTH_TIMEOUT_MS, params.signal);
      console.log(`[${id}-tts] synth voice=${params.voice.id} text=${text.length}c bytes=${buf.length} took=${((Date.now() - t0) / 1000).toFixed(1)}s`);
      // Ohne eigenes Tempo: danach per ffmpeg
      if (meta.speed || Math.abs(speed - 1) < 1e-3) {
        await writeFile(params.outPath, buf);
      } else {
        const raw = `${params.outPath}.raw.mp3`;
        await writeFile(raw, buf);
        try {
          await applyAtempo(raw, params.outPath, speed);
        } finally {
          await unlink(raw).catch(() => {});
        }
      }
      return { path: params.outPath, bytes: buf.length };
    },

    preview: (params: PreviewParams) => speak(id, params.voice, params.text, 1.0, PREVIEW_TIMEOUT_MS),
  };
}

export const kokoroEngine = createEngine("kokoro");
export const f5Engine = createEngine("f5");
export const tadaEngine = createEngine("tada");
