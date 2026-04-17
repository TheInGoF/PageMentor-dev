/**
 * Engine-agnostischer Einstiegspunkt für Kapitel-TTS.
 *
 * Dispatch pro Voice-ID:
 *   - Edge-Voices        → SSML → Azure Read-Aloud-Websocket → MP3 auf Disk
 *   - Piper (lokal)      → Plain-Text → piper-Binary → WAV → ffmpeg → MP3
 *
 * Preview-Pfad hat dieselbe Dispatch-Logik.
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { createWriteStream, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { findVoice } from "./voices";
import {
  synthesizePiperPreview,
  synthesizeTextToWav,
  wavToMp3,
} from "./piper";

/**
 * Engine-agnostisch: synthetisiert ein *Segment* eines Kapitels zu MP3.
 * Für Edge wird `ssml` verwendet, für Piper nur der reine Text.
 */
export async function synthesizeSegmentToFile(params: {
  ssml: string;
  text: string;
  voice: string;
  outPath: string;
}): Promise<{ path: string; bytes: number }> {
  const v = findVoice(params.voice);
  if (v?.engine === "piper") {
    const dir = mkdtempSync(join(tmpdir(), "piper-chunk-"));
    const wav = join(dir, "chunk.wav");
    try {
      await synthesizeTextToWav({ text: params.text, voiceId: params.voice, outPath: wav });
      await wavToMp3(wav, params.outPath);
      const { statSync } = await import("fs");
      const bytes = statSync(params.outPath).size;
      if (bytes === 0) throw new Error(`Piper produced empty audio for voice=${params.voice}`);
      return { path: params.outPath, bytes };
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }
  return synthesizeEdgeSsmlToFile({ ssml: params.ssml, voice: params.voice, outPath: params.outPath });
}

/**
 * Rückwärtskompatibler Edge-spezifischer Einstieg — direkt via SSML.
 * Wird weiter von Call-Sites benutzt, die bewusst Edge fahren.
 */
export async function synthesizeSsmlToFile(params: {
  ssml: string;
  voice: string;
  outPath: string;
}): Promise<{ path: string; bytes: number }> {
  return synthesizeEdgeSsmlToFile(params);
}

async function synthesizeEdgeSsmlToFile(params: {
  ssml: string;
  voice: string;
  outPath: string;
}): Promise<{ path: string; bytes: number }> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(params.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.rawToStream(params.ssml);

  const fileStream = createWriteStream(params.outPath);
  let bytes = 0;
  audioStream.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
  });

  try {
    await pipeline(audioStream as unknown as Readable, fileStream);
  } finally {
    tts.close();
  }

  if (bytes === 0) {
    throw new Error(`TTS produced empty audio for voice=${params.voice}`);
  }
  return { path: params.outPath, bytes };
}

/** Einmaliges kurzes Preview — ohne Disk-Write, zurück als Buffer. */
export async function synthesizePreview(params: {
  voice: string;
  locale: string;
  text: string;
}): Promise<Buffer> {
  const v = findVoice(params.voice);
  if (v?.engine === "piper") {
    return synthesizePiperPreview({ voiceId: params.voice, text: params.text });
  }

  const tts = new MsEdgeTTS();
  await tts.setMetadata(params.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${params.locale}">
    <voice name="${params.voice}">
      <prosody rate="+0%" pitch="+0Hz">${escape(params.text)}</prosody>
    </voice>
  </speak>`;
  const { audioStream } = tts.rawToStream(ssml);
  const chunks: Buffer[] = [];
  for await (const c of audioStream as unknown as AsyncIterable<Buffer>) chunks.push(c);
  tts.close();
  return Buffer.concat(chunks);
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
