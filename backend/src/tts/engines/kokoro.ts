/**
 * Kokoro-Engine — lokales TTS via Kokoro-FastAPI-Sidecar(s).
 *
 * Apache-2.0-Modell (~82 M Parameter). API ist OpenAI-kompatibel:
 *   POST /v1/audio/speech     → MP3-Bytes
 *   GET  /v1/audio/voices     → ["af_alloy", "df_eva", …]
 *
 * Multi-Sidecar-Support:
 *   - PM_KOKORO_URL    → Standard-Sidecar (remsky/Kokoro-FastAPI),
 *                        bringt EN/Multilingual-Voices mit. Default
 *                        http://kokoro:8880 im Compose-Stack.
 *   - PM_KOKORO_DE_URL → optionaler DE-Sidecar
 *                        (r1di/kokoro-fastapi-german), liefert die
 *                        deutschen Community-Voices df_eva + dm_bernd
 *                        die im Standard-Image fehlen.
 *
 * Voice-Discovery fragt beide Sidecars ab und merged die Listen.
 * Pro Voice merken wir uns intern, welcher Sidecar sie liefert —
 * Synthese-Calls routen zur richtigen URL anhand der Voice-ID.
 *
 * `listVoices()` ist synchron (Cache-Snapshot), Refresh läuft im
 * Hintergrund. Bei abgelaufenem TTL wird re-discovered, der nächste
 * Call sieht dann frische Voices.
 *
 * Voice-IDs folgen der Konvention `<lang_letter><gender>_<name>`:
 *   d = Deutsch · a = American English · b = British English · …
 *   f = female  · m = male
 * Aus dem Prefix leiten wir Sprache/Locale/Gender ab — dadurch nehmen
 * wir Community-Voices (z. B. neue DE-Finetunes) ohne Code-Änderung
 * mit, sobald sie in irgendeinem konfigurierten Sidecar liegen.
 */

import { writeFile } from "fs/promises";
import type {
  TtsEngine,
  Voice,
  SynthesizeParams,
  SynthesizeResult,
  PreviewParams,
} from "./base";

interface SidecarSource {
  url: string;
  /** Kurzer Bezeichner für Logs ("main", "de"). */
  label: string;
}

const SOURCES: SidecarSource[] = [
  {
    url: process.env.PM_KOKORO_URL || "http://kokoro:8880",
    label: "main",
  },
];
{
  const deUrl = process.env.PM_KOKORO_DE_URL;
  if (deUrl && deUrl.trim().length > 0) {
    SOURCES.push({ url: deUrl.trim(), label: "de" });
  }
}

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

let cache: {
  voices: Voice[];
  /** voiceId → sidecar URL — wir routen Synthese-Calls anhand dieser
   *  Map zur Quelle, von der wir die Voice gediscovert haben. */
  voiceUrl: Map<string, string>;
  refreshedAt: number;
  alive: boolean;
} = {
  voices: [],
  voiceUrl: new Map(),
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

/** Eine einzelne Sidecar-URL nach ihrem Voice-Katalog fragen. */
async function discoverFromSource(
  source: SidecarSource
): Promise<{ voices: Voice[]; ok: boolean }> {
  try {
    const res = await fetch(`${source.url}/v1/audio/voices`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(
        `[kokoro:${source.label}] HTTP ${res.status} from ${source.url}`
      );
      return { voices: [], ok: false };
    }
    const data = (await res.json()) as KokoroVoicesResponse;
    const voices = (data.voices ?? [])
      .map(toVoice)
      .filter((v): v is Voice => v !== null);
    return { voices, ok: true };
  } catch (err) {
    console.warn(
      `[kokoro:${source.label}] sidecar nicht erreichbar (${source.url}): ${(err as Error).message}`
    );
    return { voices: [], ok: false };
  }
}

async function doRefresh(): Promise<void> {
  const allVoices: Voice[] = [];
  const voiceUrl = new Map<string, string>();
  let anyAlive = false;
  let totalDe = 0;

  for (const source of SOURCES) {
    const { voices, ok } = await discoverFromSource(source);
    if (ok) anyAlive = true;
    for (const v of voices) {
      if (voiceUrl.has(v.id)) continue; // erste Quelle gewinnt bei ID-Konflikt
      allVoices.push(v);
      voiceUrl.set(v.id, source.url);
      if (v.language === "de") totalDe++;
    }
    if (ok) {
      console.log(
        `[kokoro:${source.label}] discovered ${voices.length} voices at ${source.url}`
      );
    }
  }

  markFlagships(allVoices);
  cache = {
    voices: allVoices,
    voiceUrl,
    refreshedAt: Date.now(),
    alive: anyAlive,
  };
  if (anyAlive) {
    console.log(
      `[kokoro] ready: ${allVoices.length} voices total, DE: ${totalDe}`
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

/** URL des Sidecars der die Voice liefert. Fallback auf den ersten
 *  konfigurierten Sidecar wenn die ID nicht im Cache ist (z. B. weil
 *  die Voice neu hinzugekommen ist und der Cache stale). */
function urlForVoice(voiceId: string): string {
  return cache.voiceUrl.get(voiceId) ?? SOURCES[0].url;
}

async function callSpeech(params: {
  text: string;
  voice: string;
  speed: number;
  timeoutMs: number;
}): Promise<Buffer> {
  const url = urlForVoice(params.voice);
  const res = await fetch(`${url}/v1/audio/speech`, {
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
    throw new Error(`Kokoro ${res.status} (${url}): ${detail.slice(0, 200)}`);
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
