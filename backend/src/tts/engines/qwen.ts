/**
 * Qwen3-TTS-Engine — spricht den pm-qwen-tts Voice-Clone-Sidecar über
 * den pm-gpu-arbiter an.
 *
 * Voice-Katalog kommt rein aus der SQLite-Tabelle `voice_samples` —
 * der User lädt Referenz-Audio-Samples (3-10 s WAV/MP3) hoch, pro
 * Sample wird ein fester Seed gewürfelt. Die Engine lädt bei jedem
 * Synthese-Call die Referenz-Datei, base64-kodiert sie, und reicht
 * sie plus den Seed an den Sidecar durch.
 *
 * Determinismus: gleicher Seed + gleicher Referenz-Clip + gleicher
 * Text ⇒ identisches Audio. Der Seed wird in der DB persistiert und
 * nie geändert, bis der User das Sample löscht.
 *
 * Voice-ID-Konvention: `custom:<uuid>`. Der Präfix signalisiert dem
 * Engine-Code, dass der Rest eine voice_samples.id ist — andere
 * Präfixe könnten später built-in Voice-Packs o. ä. sein, ohne das
 * UI anzufassen.
 */

import { writeFile, unlink } from "fs/promises";
import { effective } from "../../services/llmConfig";
import {
  getVoiceSample,
  listVoiceSamples,
  readVoiceRefBytes,
  recordChunkTiming,
  type VoiceSample,
} from "../../services/voiceSamples";
import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  designRefPath,
  getVoiceDesign,
  listVoiceDesigns,
  recordDesignChunkTiming,
  setDesignReference,
  type VoiceDesign,
} from "../../services/voiceDesigns";
import { applyAtempo } from "../ffmpeg";
import { listPresetVoices, speakerForPresetId } from "../presetVoices";
import type {
  TtsEngine,
  Voice,
  SynthesizeParams,
  SynthesizeResult,
  PreviewParams,
} from "./base";

const CUSTOM_VOICE_PREFIX = "custom:";
const DESIGN_VOICE_PREFIX = "design:";

function baseUrl(): string {
  const u =
    effective("qwenTtsUrl", "PM_QWEN_TTS_URL") ||
    process.env.PM_GPU_ARBITER_URL ||
    "http://pm-gpu-arbiter:8790";
  return u.replace(/\/+$/, "");
}

function apiKey(): string {
  return effective("qwenTtsApiKey", "PM_QWEN_TTS_API_KEY") || "";
}

const MODEL = process.env.PM_QWEN_TTS_MODEL || "Qwen/Qwen3-TTS-12Hz-1.7B-Base";

const DISCOVERY_TIMEOUT_MS = 5_000;
// Qwen3-TTS-Base auf einer 3090 braucht ohne flash-attn gut 5-8 min für
// einen langen Chunk (Intros, volle Absätze). Mit flash-attn 2 eher 2-4
// min. 10 min Puffer verhindert, dass das Backend abschneidet bevor das
// Modell fertig ist — der Client-HTTP-Hop bleibt offen (kein Buffern)
// und Chrome/Firefox haben Default-Fetch-Timeout „nie".
const SYNTH_TIMEOUT_MS = 10 * 60_000;
const PREVIEW_TIMEOUT_MS = 3 * 60_000;

const REFRESH_TTL_MS = 5 * 60_000;
const REFRESH_RETRY_MS = 15_000;

interface ProbeState {
  alive: boolean;
  refreshedAt: number;
}

let probe: ProbeState = { alive: false, refreshedAt: 0 };
let refreshing: Promise<void> | null = null;

function authHeaders(): Record<string, string> {
  const k = apiKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

async function discover(): Promise<void> {
  const url = baseUrl();
  try {
    const statusRes = await fetch(`${url}/status`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!statusRes.ok) {
      probe = { alive: false, refreshedAt: Date.now() };
      console.warn(`[qwen-tts] arbiter /status HTTP ${statusRes.status}`);
      return;
    }
    probe = { alive: true, refreshedAt: Date.now() };
    console.log(`[qwen-tts] ready via ${url} (model=${MODEL})`);
  } catch (err) {
    probe = { alive: false, refreshedAt: Date.now() };
    console.warn(
      `[qwen-tts] arbiter nicht erreichbar (${url}): ${(err as Error).message}`
    );
  }
}

function refreshOnce(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = discover().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

refreshOnce().catch(() => {});

function maybeRefresh(): void {
  const ttl = probe.alive ? REFRESH_TTL_MS : REFRESH_RETRY_MS;
  if (Date.now() - probe.refreshedAt > ttl) {
    refreshOnce().catch(() => {});
  }
}

function parseRate(rate: string): number {
  const m = /^([+-])(\d+)%$/.exec(rate);
  if (!m) return 1.0;
  const sign = m[1] === "+" ? 1 : -1;
  const pct = parseInt(m[2], 10);
  return Math.max(0.5, Math.min(2.0, 1 + (sign * pct) / 100));
}

function sampleToVoice(s: VoiceSample, idx: number): Voice {
  const locale =
    s.language === "de" ? "de-DE" : s.language === "en" ? "en-US" : s.language;
  return {
    id: `${CUSTOM_VOICE_PREFIX}${s.id}`,
    label: s.label,
    language: s.language,
    locale,
    gender: s.gender,
    engine: "qwen",
    // Erste Voice einer Sprache als Flagship markieren — damit der Audio-
    // Picker bei einem frischen Upload direkt einen Default wählt.
    flagship: idx === 0,
    note: s.refText
      ? "Qwen3-TTS Voice-Clone · mit Transkript-Referenz"
      : "Qwen3-TTS Voice-Clone · x-vector-only",
    msPerChar: s.msPerChar,
  };
}

function designToVoice(d: VoiceDesign): Voice {
  const locale =
    d.language === "de" ? "de-DE" : d.language === "en" ? "en-US" : d.language;
  const hint = d.description.slice(0, 60).replace(/\s+/g, " ").trim();
  return {
    id: `${DESIGN_VOICE_PREFIX}${d.id}`,
    label: `${d.label} · Design`,
    language: d.language,
    locale,
    gender: d.gender,
    engine: "qwen",
    flagship: false,
    note: `Qwen3-TTS VoiceDesign · "${hint}${hint.length === 60 ? "…" : ""}"`,
    msPerChar: d.msPerChar,
  };
}

function resolveSample(voiceId: string): VoiceSample | null {
  if (!voiceId.startsWith(CUSTOM_VOICE_PREFIX)) return null;
  const id = voiceId.slice(CUSTOM_VOICE_PREFIX.length);
  return getVoiceSample(id);
}

function resolveDesign(voiceId: string): VoiceDesign | null {
  if (!voiceId.startsWith(DESIGN_VOICE_PREFIX)) return null;
  const id = voiceId.slice(DESIGN_VOICE_PREFIX.length);
  return getVoiceDesign(id);
}

/** Deterministischer Seed pro Preset-Voice — gleicher Speaker → gleicher
 *  Seed → kein RNG-Drift zwischen Chunks. Speaker-Name als stabiles
 *  Identity-Token; Hash-Fold auf 32 Bit. */
function seedForSpeaker(speaker: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < speaker.length; i++) {
    h ^= speaker.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % 2_147_483_647 || 42;
}

function qwenLanguageFor(lang: string): string {
  return lang === "de" ? "German" : "English";
}

async function callSpeechClone(params: {
  text: string;
  sample: VoiceSample;
  speed: number;
  timeoutMs: number;
}): Promise<Buffer> {
  const url = baseUrl();
  const refBytes = readVoiceRefBytes(params.sample);
  const refB64 = refBytes.toString("base64");

  const res = await fetch(`${url}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      model: MODEL,
      input: params.text,
      voice: params.sample.id,            // nur für Logging im Sidecar
      response_format: "mp3",
      speed: params.speed,
      ref_audio_b64: refB64,
      ref_text: params.sample.refText ?? undefined,
      language: qwenLanguageFor(params.sample.language),
      seed: params.sample.seed,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, voice=${params.sample.id}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

function parseNumConfig(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseIntConfig(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

interface AdvancedDials {
  temperature?: number;
  topP?: number;
  maxNewTokens?: number;
  seedOverride?: number;
}

function readDials(): AdvancedDials {
  return {
    temperature: parseNumConfig(effective("qwenTtsTemperature", "PM_QWEN_TTS_TEMPERATURE")),
    topP: parseNumConfig(effective("qwenTtsTopP", "PM_QWEN_TTS_TOP_P")),
    maxNewTokens: parseIntConfig(effective("qwenTtsMaxNewTokens", "PM_QWEN_TTS_MAX_NEW_TOKENS")),
    seedOverride: parseIntConfig(effective("qwenTtsSeedOverride", "PM_QWEN_TTS_SEED_OVERRIDE")),
  };
}

/** Baut den `instruct`-Prompt für Qwen-VoiceDesign. Prepend eines
 *  Gender-Cues ist nötig, weil Qwen selbst kein Gender-Feld hat —
 *  der UI-Dropdown hätte sonst keinen Effekt, und der User würde bei
 *  einer Beschreibung wie „warmer Erzähler, Anfang 40" eine männliche
 *  Stimme bekommen obwohl er „weiblich" ausgewählt hat.
 *
 *  Wir prüfen zuerst ob die Beschreibung bereits ein Gender-Wort
 *  enthält (Erzähler/Erzählerin, female/male voice, woman/man).
 *  Wenn ja, nicht doppelt taggen — der User weiß was er will. */
function buildDesignInstruct(design: VoiceDesign): string {
  const desc = design.description.trim();
  const lower = desc.toLowerCase();
  const hasGenderCue =
    /\b(erzählerin|sprecherin|frau|weiblich|female|woman)\b/.test(lower) ||
    /\b(erzähler|sprecher|mann|männlich|male voice|\bman\b)\b/.test(lower);
  if (hasGenderCue) return desc;
  const prefix =
    design.gender === "female" ? "Female voice. " : "Male voice. ";
  return prefix + desc;
}

/** Sendet Text + Design-Referenz-Audio als Base-Voice-Clone-Request
 *  an den Sidecar. Damit ist die Stimm-Identität über alle Chunks
 *  stabil — Base-Clone IST seed-deterministisch, VoiceDesign ist es
 *  nicht. Offizielles "Voice Design then Clone"-Pattern aus der
 *  Qwen3-TTS-README.
 */
async function callSpeechCloneFromDesign(params: {
  text: string;
  design: VoiceDesign;
  timeoutMs: number;
}): Promise<Buffer> {
  if (!params.design.refPath || !existsSync(params.design.refPath)) {
    throw new Error(
      `Design ${params.design.id} hat keine Referenz-Audio — bitte neu anlegen oder ensureDesignReference() aufrufen.`
    );
  }
  const url = baseUrl();
  const refBytes = readFileSync(params.design.refPath);
  const refB64 = refBytes.toString("base64");

  const res = await fetch(`${url}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      model: MODEL,
      input: params.text,
      voice: `design:${params.design.id}`,
      response_format: "mp3",
      speed: 1.0,
      ref_audio_b64: refB64,
      ref_text: params.design.refText ?? undefined,
      language: qwenLanguageFor(params.design.language),
      seed: params.design.seed,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS-Clone-from-Design ${res.status} (design=${params.design.id}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Stellt sicher, dass eine Design-Voice eine Referenz-Audio-Datei
 *  auf Disk hat. Wenn nicht, wird EINMAL via VoiceDesign generiert,
 *  das Ergebnis als MP3 gespeichert und die DB-Row geupdatet. Danach
 *  zeigt `design.refPath` auf die Datei. Gibt das aktualisierte Design
 *  zurück.
 *
 *  Nötig für alte Designs aus v1.18.025-v1.18.032 (vor dem Refactor
 *  auf Clone-Pattern) sowie als Server-Fallback wenn der Client beim
 *  Create keinen Blob mitschickt.
 */
export async function ensureDesignReference(
  design: VoiceDesign,
  timeoutMs: number = 3 * 60_000
): Promise<VoiceDesign> {
  if (design.refPath && existsSync(design.refPath)) return design;

  const refText =
    design.language === "de"
      ? "Hallo, dies ist eine Sprachprobe. Der Text geht über mehrere Sätze, damit die Stimm-Charakteristik sichtbar wird."
      : "Hello, this is a voice sample. The text spans several sentences so the voice character becomes clear.";

  console.log(
    `[qwen-tts] ensuring reference audio for design ${design.id} — generating via VoiceDesign (one-time)`
  );
  const buf = await previewDesignUnsaved({
    text: refText,
    description: design.description,
    gender: design.gender,
    language: design.language,
    seed: design.seed,
    timeoutMs,
  });
  const path = designRefPath(design.id);
  writeFileSync(path, buf);
  setDesignReference(design.id, path, refText);
  console.log(
    `[qwen-tts] design ${design.id} reference saved to ${path} (${buf.length} bytes)`
  );
  return { ...design, refPath: path, refText };
}

/** Preview-Synthese für eine NOCH-NICHT-gespeicherte Voice-Design —
 *  wird vom Settings-Form genutzt bevor die Design-Zeile in die DB
 *  persistiert wird. Ermöglicht Seed-Reroll ohne Insert-Delete-Dance.
 *  Das Ergebnis wird NICHT benchmarkt (kein DB-Row zum Aktualisieren).
 *
 *  Dials-Default = llm-config. Damit klingt die Wizard-Vorschau
 *  identisch zur späteren Hörbuch-Synthese (beide lesen denselben
 *  temperature/top_p/seed-Override aus der Config). Bei Caller-
 *  supplied `dials` haben diese Vorrang — für Live-UI-Tuning. */
export async function previewDesignUnsaved(params: {
  text: string;
  description: string;
  gender: "female" | "male";
  language: string;
  seed: number;
  timeoutMs: number;
  dials?: AdvancedDials;
}): Promise<Buffer> {
  const ephemeral: VoiceDesign = {
    id: "ephemeral-preview",
    label: "preview",
    gender: params.gender,
    language: params.language,
    description: params.description,
    seed: params.seed,
    createdAt: "",
    msPerChar: null,
    samplesCount: 0,
    refPath: null,
    refText: null,
  };
  return callSpeechDesign({
    text: params.text,
    design: ephemeral,
    timeoutMs: params.timeoutMs,
    dials: params.dials ?? readDials(),
  });
}

async function callSpeechDesign(params: {
  text: string;
  design: VoiceDesign;
  timeoutMs: number;
  dials?: AdvancedDials;
}): Promise<Buffer> {
  const url = baseUrl();
  const d = params.dials ?? {};
  const seed =
    d.seedOverride !== undefined && Number.isFinite(d.seedOverride)
      ? d.seedOverride
      : params.design.seed;

  const instructForQwen = buildDesignInstruct(params.design);

  const res = await fetch(`${url}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      model: MODEL,
      input: params.text,
      voice: `design:${params.design.id}`,
      response_format: "mp3",
      speed: 1.0,
      voice_description: instructForQwen,
      language: qwenLanguageFor(params.design.language),
      seed,
      temperature: d.temperature,
      top_p: d.topP,
      max_new_tokens_override: d.maxNewTokens,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, design=${params.design.id}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

async function callSpeechPreset(params: {
  text: string;
  speaker: string;
  instruct: string | undefined;
  language: string; // "de" | "en"
  timeoutMs: number;
  dials?: AdvancedDials;
}): Promise<Buffer> {
  const url = baseUrl();
  const d = params.dials ?? {};
  const seed =
    d.seedOverride !== undefined && Number.isFinite(d.seedOverride)
      ? d.seedOverride
      : seedForSpeaker(params.speaker);

  const res = await fetch(`${url}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      model: MODEL,
      input: params.text,
      voice: `preset:${params.speaker}`,
      response_format: "mp3",
      speed: 1.0,
      speaker: params.speaker,
      instruct: params.instruct || undefined,
      language: qwenLanguageFor(params.language),
      seed,
      temperature: d.temperature,
      top_p: d.topP,
      max_new_tokens_override: d.maxNewTokens,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(
      `Qwen-TTS ${res.status} (${url}/v1/audio/speech, preset=${params.speaker}): ${detail.slice(0, 200)}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export const qwenEngine: TtsEngine = {
  id: "qwen",

  isAvailable: () => {
    maybeRefresh();
    // Engine ist auch „verfügbar" wenn Arbiter lebt aber noch keine
    // Samples hochgeladen sind — die listVoices-Liste ist dann leer,
    // also taucht keine Voice im Picker auf. Das ist die gewünschte UX.
    return probe.alive;
  },

  listVoices: () => {
    maybeRefresh();
    // Preset-Voices kommen aus dem CustomVoice-Modell (9 Speaker,
    // keine Stil-Drift zwischen Chunks) — immer anbieten, auch wenn
    // der User noch keine eigenen Samples hochgeladen hat.
    const presets = listPresetVoices();
    let designs: Voice[] = [];
    try {
      designs = listVoiceDesigns().map(designToVoice);
    } catch (err) {
      console.warn(`[qwen-tts] listVoiceDesigns failed:`, err);
    }
    try {
      const customs = listVoiceSamples().map(sampleToVoice);
      return [...presets, ...designs, ...customs];
    } catch (err) {
      console.warn(`[qwen-tts] listVoiceSamples failed:`, err);
      return [...presets, ...designs];
    }
  },

  async synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
    const announce = params.announce ? `${params.announce}.\n\n` : "";
    const text = announce + params.segment.paragraphs.join("\n\n");
    const speed = parseRate(params.rate);
    const t0 = Date.now();

    const presetSpeaker = speakerForPresetId(params.voice.id);
    const design = resolveDesign(params.voice.id);
    let buf: Buffer;

    if (design) {
      // Offizielles Qwen-Pattern: Design-Voice einmalig referenz-
      // bouncen, dann über Base-Clone rendern. Das ist seed-stabil —
      // jeder Chunk bekommt dieselbe Stimm-Identität. VoiceDesign
      // direkt pro Chunk aufzurufen wäre es nicht.
      const ready = await ensureDesignReference(design, SYNTH_TIMEOUT_MS);
      console.log(
        `[qwen-tts] synth design=${ready.id} (${ready.label}) via clone text=${text.length}c rate=${params.rate} seed=${ready.seed}`
      );
      buf = await callSpeechCloneFromDesign({
        text,
        design: ready,
        timeoutMs: SYNTH_TIMEOUT_MS,
      });
    } else if (presetSpeaker) {
      const instruct = effective("qwenTtsInstruction", "PM_QWEN_TTS_INSTRUCTION");
      const dials = readDials();
      console.log(
        `[qwen-tts] synth preset=${presetSpeaker} text=${text.length}c rate=${params.rate} ` +
          `instruct=${instruct ? "yes" : "no"} temp=${dials.temperature ?? "def"} ` +
          `top_p=${dials.topP ?? "def"} seedOverride=${dials.seedOverride ?? "auto"}`
      );
      buf = await callSpeechPreset({
        text,
        speaker: presetSpeaker,
        instruct,
        language: params.voice.language,
        timeoutMs: SYNTH_TIMEOUT_MS,
        dials,
      });
    } else {
      const sample = resolveSample(params.voice.id);
      if (!sample) {
        throw new Error(
          `Qwen-TTS voice sample ${params.voice.id} not found in DB`
        );
      }
      // Qwen-Base akzeptiert KEIN speed-Kwarg im generate_voice_clone —
      // das Tempo zieht's aus dem Referenz-Audio. Wir senden die
      // Rohausgabe und passen die Geschwindigkeit danach per ffmpeg
      // atempo an (ändert Tempo ohne Tonhöhe zu verschieben).
      console.log(
        `[qwen-tts] synth clone voice=${params.voice.id} text=${text.length}c rate=${params.rate}`
      );
      buf = await callSpeechClone({
        text,
        sample,
        speed: 1.0, // Info fürs Sidecar-Log, faktisch ignoriert
        timeoutMs: SYNTH_TIMEOUT_MS,
      });
    }
    console.log(
      `[qwen-tts] synth response voice=${params.voice.id} bytes=${buf.length} took=${((Date.now() - t0) / 1000).toFixed(1)}s`
    );

    if (buf.length === 0) {
      throw new Error(
        `Qwen-TTS returned empty audio for voice=${params.voice.id}`
      );
    }

    if (Math.abs(speed - 1.0) < 1e-3) {
      await writeFile(params.outPath, buf);
    } else {
      const rawPath = `${params.outPath}.raw.mp3`;
      await writeFile(rawPath, buf);
      try {
        await applyAtempo(rawPath, params.outPath, speed);
      } finally {
        try {
          await unlink(rawPath);
        } catch {
          /* best effort */
        }
      }
      console.log(
        `[qwen-tts] applied atempo=${speed.toFixed(3)} → ${params.outPath}`
      );
    }

    // Benchmark-Updates: Preset-Voices teilen keinen DB-Record, darum
    // überspringen. Custom-Samples und Designs haben je eigene ID-
    // stabile Tabelle — ETA-EMA dort hochzählen.
    if (design) {
      try {
        recordDesignChunkTiming(design.id, text.length, Date.now() - t0);
      } catch (e) {
        console.warn("[qwen-tts] design benchmark update failed:", e);
      }
    } else if (!presetSpeaker) {
      const sample = resolveSample(params.voice.id);
      if (sample) {
        try {
          recordChunkTiming(sample.id, text.length, Date.now() - t0);
        } catch (e) {
          console.warn("[qwen-tts] benchmark update failed:", e);
        }
      }
    }

    return { path: params.outPath, bytes: buf.length };
  },

  async preview(params: PreviewParams): Promise<Buffer> {
    const design = resolveDesign(params.voice.id);
    if (design) {
      // Preview auf einer GESPEICHERTEN Design-Voice geht über Clone —
      // dieselbe stabile Stimme die der User im Audiobook hören wird.
      const ready = await ensureDesignReference(design, PREVIEW_TIMEOUT_MS);
      const buf = await callSpeechCloneFromDesign({
        text: params.text,
        design: ready,
        timeoutMs: PREVIEW_TIMEOUT_MS,
      });
      if (buf.length === 0) {
        throw new Error(
          `Qwen-TTS preview returned empty audio for voice=${params.voice.id}`
        );
      }
      return buf;
    }

    const presetSpeaker = speakerForPresetId(params.voice.id);
    if (presetSpeaker) {
      const instruct =
        params.instructOverride !== undefined
          ? params.instructOverride
          : effective("qwenTtsInstruction", "PM_QWEN_TTS_INSTRUCTION");
      // Preview nutzt dieselben Dials wie Produktiv-Synthese — User
      // hört direkt was er bei der Generierung kriegen wird. Pro-Request-
      // Overrides (Tester-UI) haben Vorrang vor Config-Defaults.
      const base = readDials();
      const dials: AdvancedDials = {
        temperature:
          params.temperatureOverride !== undefined
            ? params.temperatureOverride
            : base.temperature,
        topP:
          params.topPOverride !== undefined
            ? params.topPOverride
            : base.topP,
        maxNewTokens:
          params.maxNewTokensOverride !== undefined
            ? params.maxNewTokensOverride
            : base.maxNewTokens,
        seedOverride:
          params.seedOverride !== undefined
            ? params.seedOverride
            : base.seedOverride,
      };
      const buf = await callSpeechPreset({
        text: params.text,
        speaker: presetSpeaker,
        instruct,
        language: params.voice.language,
        timeoutMs: PREVIEW_TIMEOUT_MS,
        dials,
      });
      if (buf.length === 0) {
        throw new Error(
          `Qwen-TTS preview returned empty audio for voice=${params.voice.id}`
        );
      }
      return buf;
    }

    const sample = resolveSample(params.voice.id);
    if (!sample) {
      throw new Error(
        `Qwen-TTS voice sample ${params.voice.id} not found in DB`
      );
    }
    const buf = await callSpeechClone({
      text: params.text,
      sample,
      speed: 1.0,
      timeoutMs: PREVIEW_TIMEOUT_MS,
    });
    if (buf.length === 0) {
      throw new Error(
        `Qwen-TTS preview returned empty audio for voice=${params.voice.id}`
      );
    }
    return buf;
  },
};
