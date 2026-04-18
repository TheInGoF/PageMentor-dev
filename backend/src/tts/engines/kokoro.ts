/**
 * Kokoro-Engine — lokales TTS via Kokoro-FastAPI-Sidecar.
 *
 * Apache-2.0-Modell (~82 M Parameter). API ist OpenAI-kompatibel:
 *   POST /v1/audio/speech     → MP3-Bytes
 *   GET  /v1/audio/voices     → ["af_alloy", "df_alpha", …]
 *
 * Voice-Discovery läuft asynchron im Hintergrund. `listVoices()` gibt
 * den letzten Cache-Snapshot synchron zurück, damit der HTTP-Handler
 * nicht blockiert. Bei abgelaufenem TTL wird im Hintergrund neu
 * gerefresht — der nächste Call sieht dann frische Voices.
 *
 * Voice-IDs folgen der Konvention `<lang_letter><gender>_<name>`:
 *   d = Deutsch · a = American English · b = British English · …
 *   f = female  · m = male
 * Aus dem Prefix leiten wir Sprache/Locale/Gender ab — dadurch nehmen
 * wir Community-Voices (z. B. neue DE-Finetunes) ohne Code-Änderung
 * mit, sobald sie im Sidecar-Voice-Verzeichnis liegen.
 */

import { writeFile } from "fs/promises";
import type {
  TtsEngine,
  Voice,
  SynthesizeParams,
  SynthesizeResult,
  PreviewParams,
} from "./base";

const KOKORO_URL = process.env.PM_KOKORO_URL || "http://kokoro:8880";
const REFRESH_TTL_MS = 5 * 60_000;
/** Wenn der Sidecar beim letzten Versuch nicht antwortete, warten wir
 *  nur kurz bis zum nächsten Probe — der Container braucht nach dem
 *  Cold-Start ~10-30 s zum Modell-Load, da wollen wir nicht 5 min in
 *  „nicht verfügbar" hängen wenn der nächste UI-Aufruf gleich kommt. */
const REFRESH_RETRY_MS = 15_000;
const SYNTH_TIMEOUT_MS = 120_000;
const PREVIEW_TIMEOUT_MS = 20_000;

interface KokoroVoicesResponse {
  voices?: string[];
}

let cache: { voices: Voice[]; refreshedAt: number; alive: boolean } = {
  voices: [],
  refreshedAt: 0,
  alive: false,
};
let refreshing: Promise<void> | null = null;

const LANG_MAP: Record<string, { language: string; locale: string }> = {
  a: { language: "en", locale: "en-US" },
  b: { language: "en", locale: "en-GB" },
  d: { language: "de", locale: "de-DE" },
  e: { language: "es", locale: "es-ES" },
  f: { language: "fr", locale: "fr-FR" },
  i: { language: "it", locale: "it-IT" },
  j: { language: "ja", locale: "ja-JP" },
  p: { language: "pt", locale: "pt-BR" },
  z: { language: "zh", locale: "zh-CN" },
  h: { language: "hi", locale: "hi-IN" },
};

function toVoice(id: string): Voice | null {
  const m = /^([a-z])([fm])_(.+)$/.exec(id);
  if (!m) return null;
  const langInfo = LANG_MAP[m[1]];
  if (!langInfo) return null;
  const rawName = m[3];
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  const region = langInfo.locale.includes("-")
    ? langInfo.locale.split("-")[1]
    : langInfo.locale.toUpperCase();
  return {
    id,
    label: `${name} (${region})`,
    language: langInfo.language,
    locale: langInfo.locale,
    gender: m[2] === "f" ? "female" : "male",
    engine: "kokoro",
  };
}

/** Erste verfügbare Stimme pro Sprache als Flagship markieren —
 *  steuert die Default-Auswahl im Picker und die `defaultVoiceFor()`-
 *  Logik. */
function markFlagships(voices: Voice[]): void {
  const seen = new Set<string>();
  for (const v of voices) {
    if (seen.has(v.language)) continue;
    v.flagship = true;
    v.note = "Lokal · Kokoro 82M (Apache 2.0)";
    seen.add(v.language);
  }
}

async function doRefresh(): Promise<void> {
  try {
    const res = await fetch(`${KOKORO_URL}/v1/audio/voices`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      cache = { voices: [], refreshedAt: Date.now(), alive: false };
      return;
    }
    const data = (await res.json()) as KokoroVoicesResponse;
    const voices = (data.voices ?? [])
      .map(toVoice)
      .filter((v): v is Voice => v !== null);
    markFlagships(voices);
    cache = { voices, refreshedAt: Date.now(), alive: voices.length > 0 };
    console.log(
      `[kokoro] discovered ${voices.length} voices at ${KOKORO_URL}` +
        (voices.length > 0
          ? ` (DE: ${voices.filter((v) => v.language === "de").length})`
          : "")
    );
  } catch (err) {
    cache = { voices: [], refreshedAt: Date.now(), alive: false };
    console.warn(
      `[kokoro] sidecar nicht erreichbar (${KOKORO_URL}): ${(err as Error).message}`
    );
  }
}

function refreshVoices(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// Background-Refresh beim Modul-Import. Fehlschläge sind OK — `voices()`
// liefert dann eine leere Liste und der Picker zeigt nur Edge.
refreshVoices().catch(() => {});

/** Stößt einen Background-Refresh an, wenn der Cache älter als das
 *  passende TTL ist. Synchron — keine Awaits, der nächste Call sieht
 *  dann den frischen Stand. Doppelaufrufe werden durch `refreshing`
 *  serialisiert. */
function maybeRefresh(): void {
  const ttl = cache.alive ? REFRESH_TTL_MS : REFRESH_RETRY_MS;
  if (Date.now() - cache.refreshedAt > ttl) {
    refreshVoices().catch(() => {});
  }
}

/** Edge-Rate-Format ("+10%", "-5%") → Kokoro-Speed (0.5..2.0). */
function parseRate(rate: string): number {
  const m = /^([+-])(\d+)%$/.exec(rate);
  if (!m) return 1.0;
  const sign = m[1] === "+" ? 1 : -1;
  const pct = parseInt(m[2], 10);
  return Math.max(0.5, Math.min(2.0, 1 + (sign * pct) / 100));
}

async function callSpeech(params: {
  text: string;
  voice: string;
  speed: number;
  timeoutMs: number;
}): Promise<Buffer> {
  const res = await fetch(`${KOKORO_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "kokoro",
      input: params.text,
      voice: params.voice,
      response_format: "mp3",
      speed: params.speed,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Kokoro ${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export const kokoroEngine: TtsEngine = {
  id: "kokoro",

  isAvailable: () => {
    // Auch wenn der Sidecar gerade nicht alive ist, periodisch
    // re-checken — sonst bleibt der Bool 5 min auf false hängen wenn
    // der Sidecar nach App-Start ein paar Sekunden später ready wird.
    maybeRefresh();
    return cache.alive;
  },

  listVoices: () => {
    maybeRefresh();
    return cache.voices;
  },

  async synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
    // Plain-Text für Kokoro — kein SSML. Kapitelansage als erster Satz
    // mit Punkt + Doppel-Newline, damit das Modell eine echte Pause
    // setzt bevor der Inhalt anfängt.
    const announce = params.announce ? `${params.announce}.\n\n` : "";
    const text = announce + params.segment.paragraphs.join("\n\n");

    const buf = await callSpeech({
      text,
      voice: params.voice.id,
      speed: parseRate(params.rate),
      timeoutMs: SYNTH_TIMEOUT_MS,
    });

    if (buf.length === 0) {
      throw new Error(
        `Kokoro returned empty audio for voice=${params.voice.id}`
      );
    }
    await writeFile(params.outPath, buf);
    return { path: params.outPath, bytes: buf.length };
  },

  async preview(params: PreviewParams): Promise<Buffer> {
    const buf = await callSpeech({
      text: params.text,
      voice: params.voice.id,
      speed: 1.0,
      timeoutMs: PREVIEW_TIMEOUT_MS,
    });
    if (buf.length === 0) {
      throw new Error(
        `Kokoro preview returned empty audio for voice=${params.voice.id}`
      );
    }
    return buf;
  },
};
