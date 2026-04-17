/**
 * Einstiegspunkt für Kapitel-TTS (Piper).
 *
 * Piper kennt kein SSML — Input ist Plain-Text, Pausen ergeben sich
 * aus Satzzeichen und Zeilenumbrüchen. Der Chapter-Runner prepended
 * die Kapitelansage als eigenen Satz.
 */

import { mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  synthesizePiperPreview,
  synthesizeTextToWav,
  wavToMp3,
} from "./piper";

export async function synthesizeSegmentToFile(params: {
  text: string;
  voice: string;
  outPath: string;
}): Promise<{ path: string; bytes: number }> {
  const dir = mkdtempSync(join(tmpdir(), "piper-chunk-"));
  const wav = join(dir, "chunk.wav");
  try {
    await synthesizeTextToWav({
      text: params.text,
      voiceId: params.voice,
      outPath: wav,
    });
    await wavToMp3(wav, params.outPath);
    const bytes = statSync(params.outPath).size;
    if (bytes === 0) {
      throw new Error(`Piper produced empty audio for voice=${params.voice}`);
    }
    return { path: params.outPath, bytes };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

/** Kurzes Preview — liefert MP3-Buffer. */
export async function synthesizePreview(params: {
  voice: string;
  text: string;
}): Promise<Buffer> {
  return synthesizePiperPreview({ voiceId: params.voice, text: params.text });
}
