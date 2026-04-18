/**
 * Edge-Engine — Microsofts Neural Voices via Edge Read-Aloud-Websocket.
 *
 * Liefert exzellente Prosodie, aber Microsoft zieht die Anti-Abuse-
 * Schranken in etwa halbjährlichem Takt nach (Sec-MS-GEC-HMAC,
 * User-Agent, Origin). `msedge-tts` hält in der Regel binnen 1–14
 * Tagen mit; ein Dependabot-PR im Repo reagiert automatisch.
 *
 * Wenn Azure throttelt oder ein stale Client stumm 0 Bytes liefert,
 * meldet der Dispatcher das nach oben — der User kann dann auf eine
 * Kokoro-Stimme (lokaler Sidecar, ohne Quota) umschalten.
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { createWriteStream } from "fs";
import { statSync } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { buildSsml } from "../ssml";
import type {
  TtsEngine,
  Voice,
  SynthesizeParams,
  SynthesizeResult,
  PreviewParams,
} from "./base";

const VOICES: Voice[] = [
  {
    id: "de-DE-SeraphinaMultilingualNeural",
    label: "Seraphina (DE)",
    language: "de",
    locale: "de-DE",
    gender: "female",
    engine: "edge",
    flagship: true,
    note: "Warme, klare Vorlesestimme — Studio-Qualität.",
  },
  {
    id: "de-DE-FlorianMultilingualNeural",
    label: "Florian (DE)",
    language: "de",
    locale: "de-DE",
    gender: "male",
    engine: "edge",
    flagship: true,
    note: "Ruhige, männliche Vorlesestimme mit exzellenter Prosodie.",
  },
  {
    id: "de-DE-KatjaNeural",
    label: "Katja (DE)",
    language: "de",
    locale: "de-DE",
    gender: "female",
    engine: "edge",
  },
  {
    id: "de-DE-ConradNeural",
    label: "Conrad (DE)",
    language: "de",
    locale: "de-DE",
    gender: "male",
    engine: "edge",
  },
  {
    id: "de-AT-IngridNeural",
    label: "Ingrid (AT)",
    language: "de",
    locale: "de-AT",
    gender: "female",
    engine: "edge",
  },
  {
    id: "de-CH-LeniNeural",
    label: "Leni (CH)",
    language: "de",
    locale: "de-CH",
    gender: "female",
    engine: "edge",
  },
  {
    id: "en-US-AvaMultilingualNeural",
    label: "Ava (US)",
    language: "en",
    locale: "en-US",
    gender: "female",
    engine: "edge",
    flagship: true,
    note: "Microsoft flagship voice — natural, expressive.",
  },
  {
    id: "en-US-AndrewMultilingualNeural",
    label: "Andrew (US)",
    language: "en",
    locale: "en-US",
    gender: "male",
    engine: "edge",
    flagship: true,
  },
  {
    id: "en-US-EmmaMultilingualNeural",
    label: "Emma (US)",
    language: "en",
    locale: "en-US",
    gender: "female",
    engine: "edge",
  },
  {
    id: "en-US-BrianMultilingualNeural",
    label: "Brian (US)",
    language: "en",
    locale: "en-US",
    gender: "male",
    engine: "edge",
  },
  {
    id: "en-GB-SoniaNeural",
    label: "Sonia (UK)",
    language: "en",
    locale: "en-GB",
    gender: "female",
    engine: "edge",
  },
  {
    id: "en-GB-RyanNeural",
    label: "Ryan (UK)",
    language: "en",
    locale: "en-GB",
    gender: "male",
    engine: "edge",
  },
];

export const edgeEngine: TtsEngine = {
  id: "edge",

  // Edge ist ein Netz-Dienst — wir prüfen nicht proaktiv, nur reaktiv
  // durch den Dispatcher-Fallback. Die Voices sind immer katalogisiert.
  isAvailable: () => true,

  listVoices: () => VOICES,

  async synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
    const ssml = buildSsml(params.segment, {
      voice: params.voice.id,
      locale: params.locale,
      rate: params.rate,
      announce: params.announce,
    });

    const tts = new MsEdgeTTS();
    await tts.setMetadata(
      params.voice.id,
      OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3
    );
    const { audioStream } = tts.rawToStream(ssml);

    const fileStream = createWriteStream(params.outPath);
    let bytes = 0;
    let streamError: Error | null = null;
    audioStream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    audioStream.on("error", (err: Error) => {
      streamError = err;
    });

    try {
      await pipeline(audioStream as unknown as Readable, fileStream);
    } catch (err) {
      // Pipeline-Errors (WebSocket-Abbruch, Server-Reject) durchreichen —
      // die sind informativer als das stumme 0-Byte-Ende.
      streamError = err instanceof Error ? err : new Error(String(err));
    } finally {
      tts.close();
    }

    if (bytes === 0) {
      // Klare Diagnose, wenn Edge nichts liefert.
      const details = [
        `voice=${params.voice.id}`,
        `locale=${params.locale}`,
        `ssml_chars=${ssml.length}`,
        `segment_paragraphs=${params.segment.paragraphs.length}`,
        `announce=${params.announce ? "yes" : "no"}`,
        streamError ? `stream_error=${streamError.message}` : "stream_error=none",
      ].join(" ");
      console.error(`[edge-tts] empty audio — ${details}`);
      if (params.announce) {
        console.error(`[edge-tts] ssml preview: ${ssml.slice(0, 220).replace(/\s+/g, " ")}…`);
      }
      throw new Error(`Edge TTS returned empty audio for voice=${params.voice.id}`);
    }
    const size = statSync(params.outPath).size;
    return { path: params.outPath, bytes: size };
  },

  async preview(params: PreviewParams): Promise<Buffer> {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(
      params.voice.id,
      OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3
    );

    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${params.locale}">
      <voice name="${params.voice.id}">
        <prosody rate="+0%" pitch="+0Hz">${escape(params.text)}</prosody>
      </voice>
    </speak>`;
    const { audioStream } = tts.rawToStream(ssml);
    const chunks: Buffer[] = [];
    for await (const c of audioStream as unknown as AsyncIterable<Buffer>) chunks.push(c);
    tts.close();
    const buf = Buffer.concat(chunks);
    if (buf.length === 0) {
      throw new Error(`Edge TTS preview returned empty audio for voice=${params.voice.id}`);
    }
    return buf;
  },
};

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
