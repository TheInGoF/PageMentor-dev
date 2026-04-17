import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

/**
 * Synthetisiere ein SSML-Snippet zu einer MP3-Datei auf der Platte.
 * Nutzt 24kHz/96kbit Mono-MP3 — höchste MP3-Qualität, die die Read-
 * Aloud-API anbietet, und ausreichend für Vorlesezwecke (Podcast-Niveau).
 *
 * Pro Aufruf wird eine neue WebSocket-Verbindung aufgebaut, damit
 * Timeouts zwischen Chunks nicht stören.
 */
export async function synthesizeSsmlToFile(params: {
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
