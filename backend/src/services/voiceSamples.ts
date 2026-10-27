/**
 * Voice sample service — user uploads for Qwen3-TTS voice clone.
 *
 * Each row in `voice_samples` = one "clonable voice". The reference
 * WAV/MP3 sits as a file in the data volume under
 * `$PM_DATA_DIR/voice-samples/<id>.<ext>`; the engine reads it on
 * every synthesis call and forwards it as base64 to the sidecar.
 *
 * Seeds are rolled once on upload and NEVER changed — that way the
 * same voice still sounds the same two months later.
 */

import { randomUUID, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { db } from "../db";
import { DATA_DIR } from "../paths";

const VOICE_DIR = join(DATA_DIR, "voice-samples");

// Upload limits — Qwen3-TTS-Base doesn't need more than 10 s for a
// clean clone; bigger uploads are usually a user misunderstanding
// (whole audiobook chapters etc.).
export const MAX_BYTES = 2_500_000; // ~2.5 MB (10 s @ 24 kHz 16-bit ≈ 0.5 MB, MP3 ≈ 120 KB)
export const ALLOWED_EXTS = new Set([".wav", ".mp3", ".flac", ".ogg", ".m4a"]);

function ensureDir(): void {
  if (!existsSync(VOICE_DIR)) mkdirSync(VOICE_DIR, { recursive: true });
}

/** ffmpeg-Pipeline auf den User-Upload bevor er als Reference
 *  gespeichert wird. Bringt das Audio in Qwens Lieblings-Format
 *  (24 kHz mono WAV) und glaettet zwei Stoerquellen die Qwens
 *  Speaker-Embedding-Extractor verwirren:
 *  - leading + trailing Silence (User-Cut-Pause vor/nach dem Sprechen)
 *  - inkonsistente Lautstaerke (loudnorm auf -23 LUFS)
 *
 *  Wir machen KEINE Rauschunterdrueckung — RNNoise/DeepFilterNet
 *  waeren weitere Pakete, und ein bisschen Mic-Hall stoert Qwen
 *  weniger als die Compress-Artefakte einer aggressiven Denoise-
 *  Pipeline. Wer's sauberer braucht, nutzt Adobe Podcast Enhance
 *  vor dem Upload.
 *
 *  Output ist immer .wav unabhaengig vom Eingabe-Format. Die
 *  Datei-Endung beim Speichern wird entsprechend angepasst. */
async function cleanupAudioForQwen(
  inputBytes: Uint8Array,
  inputExt: string
): Promise<Uint8Array> {
  ensureDir();
  const id = randomUUID();
  const inPath = join(tmpdir(), `voice-in-${id}${inputExt}`);
  const outPath = join(tmpdir(), `voice-out-${id}.wav`);
  writeFileSync(inPath, inputBytes);

  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-loglevel",
      "error",
      "-i",
      inPath,
      "-ac",
      "1", // mono
      "-ar",
      "24000", // Qwen3-TTS-12Hz Sample-Rate
      "-af",
      [
        // Lautstaerke-Normalisierung. EBU-R128, -23 LUFS Standard.
        "loudnorm=I=-23:TP=-2:LRA=7",
        // Silence vorne weg.
        "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB:detection=peak",
        // Trick fuer trailing-silence: Audio reversen → wieder
        // start_silence entfernen → wieder reversen. ffmpeg's
        // silenceremove kann nativ keinen "stop_silence".
        "areverse",
        "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB:detection=peak",
        "areverse",
      ].join(","),
      "-c:a",
      "pcm_s16le", // 16-bit signed PCM, was Qwen erwartet
      outPath,
    ];

    const ff = spawn("ffmpeg", args);
    let stderrBuf = "";
    ff.stderr.on("data", (d: Buffer) => {
      stderrBuf += d.toString();
    });
    ff.on("error", (err) => {
      try {
        unlinkSync(inPath);
      } catch {
        /* best effort */
      }
      reject(new Error(`ffmpeg spawn failed: ${err.message}`));
    });
    ff.on("close", (code) => {
      try {
        unlinkSync(inPath);
      } catch {
        /* best effort */
      }
      if (code !== 0) {
        try {
          if (existsSync(outPath)) unlinkSync(outPath);
        } catch {
          /* best effort */
        }
        reject(
          new Error(
            `ffmpeg cleanup failed (code=${code}): ${stderrBuf.slice(0, 400)}`
          )
        );
        return;
      }
      try {
        const cleaned = readFileSync(outPath);
        unlinkSync(outPath);
        console.log(
          `[voice-samples] cleanup ${inputBytes.byteLength}B (${inputExt}) → ` +
            `${cleaned.byteLength}B (.wav 24kHz mono)`
        );
        resolve(new Uint8Array(cleaned));
      } catch (err) {
        reject(
          new Error(
            `failed to read cleaned audio: ${(err as Error).message}`
          )
        );
      }
    });
  });
}

export type Gender = "female" | "male";

export interface VoiceSample {
  id: string;
  label: string;
  gender: Gender;
  language: string;
  refPath: string;
  refText: string | null;
  seed: number;
  bytes: number;
  durationMs: number;
  createdAt: string;
  /** Rolling average of TTS synthesis speed for this voice —
   *  milliseconds per input character. Updated via EMA (alpha=0.2)
   *  after every successful chunk. `null` if never synthesized
   *  successfully. The frontend uses this for the initial ETA of an
   *  audiobook run. */
  msPerChar: number | null;
  samplesCount: number;
  /** Whether this voice appears in the audiobook tab's voice picker.
   *  With ~30 candidates the dropdown becomes unreadable; users can
   *  hide voices they don't intend to narrate with. */
  showInAudiobook: boolean;
  /** Optional speaking-style prompt forwarded to generate_voice_clone
   *  as `instruct`. Without it, Qwen drifts in tempo between chunks
   *  because the reference audio alone doesn't fix prosody. Examples:
   *  "Calm narrator, steady pace", "Slow audiobook narration". */
  instruct: string | null;
}

interface Row {
  id: string;
  label: string;
  gender: string;
  language: string;
  ref_path: string;
  ref_text: string | null;
  seed: number;
  bytes: number;
  duration_ms: number;
  created_at: string;
  ms_per_char: number | null;
  samples_count: number;
  show_in_audiobook: number | null;
  instruct: string | null;
}

function rowToSample(r: Row): VoiceSample {
  return {
    id: r.id,
    label: r.label,
    gender: r.gender === "male" ? "male" : "female",
    language: r.language,
    refPath: r.ref_path,
    refText: r.ref_text,
    seed: r.seed,
    bytes: r.bytes,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
    msPerChar: r.ms_per_char ?? null,
    samplesCount: r.samples_count ?? 0,
    showInAudiobook: (r.show_in_audiobook ?? 1) === 1,
    instruct: r.instruct ?? null,
  };
}

/** Toggle the audiobook-picker visibility flag. */
export function setVoiceSampleVisibility(id: string, show: boolean): boolean {
  const res = db()
    .prepare("UPDATE voice_samples SET show_in_audiobook = ? WHERE id = ?")
    .run(show ? 1 : 0, id);
  return res.changes > 0;
}

/** Patch text/meta fields on a voice sample. The audio file and the
 *  seed are deliberately NOT patchable — changing them would break
 *  the voice identity. Returns the updated row or null if not found. */
export interface VoiceSamplePatch {
  label?: string;
  gender?: Gender;
  language?: string;
  refText?: string | null;
  instruct?: string | null;
}
export function updateVoiceSample(
  id: string,
  patch: VoiceSamplePatch
): VoiceSample | null {
  const sample = getVoiceSample(id);
  if (!sample) return null;
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (patch.label !== undefined) {
    const v = patch.label.trim();
    if (!v) throw new Error("label cannot be empty");
    sets.push("label = ?");
    args.push(v);
  }
  if (patch.gender !== undefined) {
    sets.push("gender = ?");
    args.push(patch.gender);
  }
  if (patch.language !== undefined) {
    sets.push("language = ?");
    args.push(patch.language);
  }
  if (patch.refText !== undefined) {
    sets.push("ref_text = ?");
    args.push(patch.refText?.trim() || null);
  }
  if (patch.instruct !== undefined) {
    sets.push("instruct = ?");
    args.push(patch.instruct?.trim() || null);
  }
  if (sets.length === 0) return sample;
  args.push(id);
  db()
    .prepare(`UPDATE voice_samples SET ${sets.join(", ")} WHERE id = ?`)
    .run(...args);
  return getVoiceSample(id);
}

export function listVoiceSamples(): VoiceSample[] {
  const rows = db()
    .prepare("SELECT * FROM voice_samples ORDER BY created_at DESC")
    .all() as Row[];
  return rows.map(rowToSample);
}

export function getVoiceSample(id: string): VoiceSample | null {
  const r = db().prepare("SELECT * FROM voice_samples WHERE id = ?").get(id) as
    | Row
    | undefined;
  return r ? rowToSample(r) : null;
}

export interface CreateVoiceSampleInput {
  label: string;
  gender: Gender;
  language?: string;
  refText?: string;
  filename: string; // original filename, only for extension
  bytes: Uint8Array;
}

export interface CreateVoiceSampleResult {
  sample: VoiceSample;
}

/** Creates a new voice sample entry. Throws on invalid extension or
 *  oversized file. Async because the upload bytes go through an
 *  ffmpeg cleanup pass (24kHz mono WAV + loudnorm + silence-trim)
 *  before being persisted — this dramatically improves Qwen's
 *  Speaker-Embedding-Extraction. */
export async function createVoiceSample(
  input: CreateVoiceSampleInput
): Promise<CreateVoiceSampleResult> {
  const label = input.label.trim();
  if (!label) {
    throw new Error("label required");
  }
  if (input.bytes.byteLength === 0) {
    throw new Error("empty audio");
  }
  if (input.bytes.byteLength > MAX_BYTES) {
    throw new Error(
      `audio too large (${input.bytes.byteLength} bytes, max ${MAX_BYTES})`
    );
  }

  const ext = extname(input.filename).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    throw new Error(
      `unsupported audio extension ${ext || "(none)"} — allowed: ${Array.from(
        ALLOWED_EXTS
      ).join(", ")}`
    );
  }

  // ffmpeg-Cleanup: bringt das Audio in Qwens Lieblings-Format,
  // glaettet Lautstaerke + Silence. Ergebnis ist immer .wav,
  // unabhaengig vom Input-Format.
  let cleanedBytes: Uint8Array;
  try {
    cleanedBytes = await cleanupAudioForQwen(input.bytes, ext);
  } catch (err) {
    // Fallback: Original-Bytes verwenden wenn Cleanup scheitert.
    // Nicht ideal, aber besser als der User kann gar nichts hochladen.
    console.warn(
      `[voice-samples] cleanup failed, falling back to raw upload:`,
      err
    );
    cleanedBytes = input.bytes;
  }

  ensureDir();
  const id = randomUUID();
  // Datei-Endung folgt dem Cleanup-Output. Wenn Cleanup-Bytes ==
  // Original-Bytes (Fallback), behaelt der File die Original-Endung.
  const storedExt = cleanedBytes === input.bytes ? ext : ".wav";
  const refPath = join(VOICE_DIR, `${id}${storedExt}`);
  writeFileSync(refPath, cleanedBytes);

  // 31-bit positive int — fits in SQLite INTEGER and Python
  // `torch.manual_seed()`.
  const seed = randomInt(1, 2 ** 31 - 1);

  db()
    .prepare(
      `INSERT INTO voice_samples (id, label, gender, language, ref_path, ref_text, seed, bytes, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      label,
      input.gender,
      input.language ?? "de",
      refPath,
      input.refText?.trim() || null,
      seed,
      cleanedBytes.byteLength,
      0 // We don't determine duration — would be an ffprobe subprocess per upload
    );

  const sample = getVoiceSample(id);
  if (!sample) {
    throw new Error("voice sample vanished right after insert");
  }
  return { sample };
}

export function deleteVoiceSample(id: string): boolean {
  const sample = getVoiceSample(id);
  if (!sample) return false;
  try {
    if (existsSync(sample.refPath)) unlinkSync(sample.refPath);
  } catch (e) {
    console.warn(`[voice-samples] failed to unlink ${sample.refPath}:`, e);
  }
  const r = db().prepare("DELETE FROM voice_samples WHERE id = ?").run(id);
  return r.changes > 0;
}

/** Reads the reference audio bytes from disk. Called by the qwen
 *  engine before each synthesis call. */
export function readVoiceRefBytes(sample: VoiceSample): Buffer {
  if (!existsSync(sample.refPath)) {
    throw new Error(
      `voice sample ${sample.id} file missing at ${sample.refPath}`
    );
  }
  return readFileSync(sample.refPath);
}

/** EMA update for a voice's synthesis speed.
 *
 *  Formula: ms_per_char_new = alpha * (elapsed / chars) + (1 - alpha) * old
 *  alpha = 0.2 → a new data point weighs 20 %, history 80 %.
 *  Smooths outliers (an occasionally stalled chunk) without letting
 *  measurements linger for years.
 *
 *  First data point: ms_per_char is set directly, no EMA blend. */
export function recordChunkTiming(
  voiceId: string,
  chars: number,
  elapsedMs: number
): void {
  if (chars < 50 || elapsedMs < 100) return; // too-small samples are noisy
  const sample = getVoiceSample(voiceId);
  if (!sample) return;

  const newRate = elapsedMs / chars;
  const alpha = 0.2;
  const next =
    sample.msPerChar === null
      ? newRate
      : alpha * newRate + (1 - alpha) * sample.msPerChar;

  db()
    .prepare(
      "UPDATE voice_samples SET ms_per_char = ?, samples_count = samples_count + 1 WHERE id = ?"
    )
    .run(next, voiceId);
}
