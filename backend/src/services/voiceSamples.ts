/**
 * Voice-Sample-Service — User-Uploads für Qwen3-TTS Voice-Clone.
 *
 * Jede Zeile in `voice_samples` = eine „kloneerbare Stimme". Die
 * Referenz-WAV/MP3 liegt als Datei im Data-Volume unter
 * `$PM_DATA_DIR/voice-samples/<id>.<ext>`, die Engine liest sie bei
 * jedem Synthese-Call und reicht sie als base64 an den Sidecar.
 *
 * Seeds werden beim Upload einmalig gewürfelt und NIE geändert —
 * so klingt dieselbe Voice zwei Monate später noch gleich.
 */

import { randomUUID, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { db } from "../db";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";
const VOICE_DIR = join(DATA_DIR, "voice-samples");

// Upload-Limits — mehr als 10 s braucht Qwen3-TTS-Base nicht für einen
// sauberen Clone; größere Uploads sind meist Anwender-Missverständnis
// (ganze Hörbuch-Kapitel etc.).
export const MAX_BYTES = 2_500_000; // ~2.5 MB (10 s @ 24 kHz 16-bit ≈ 0.5 MB, MP3 ≈ 120 KB)
export const ALLOWED_EXTS = new Set([".wav", ".mp3", ".flac", ".ogg", ".m4a"]);

function ensureDir(): void {
  if (!existsSync(VOICE_DIR)) mkdirSync(VOICE_DIR, { recursive: true });
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
  /** Gleitender Durchschnitt der TTS-Synthese-Geschwindigkeit für
   *  diese Voice — Millisekunden pro Eingabe-Zeichen. Wird nach jedem
   *  erfolgreichen Chunk via EMA (alpha=0.2) aktualisiert. `null`
   *  wenn noch nie erfolgreich synthetisiert wurde. Frontend nutzt
   *  das für die initiale ETA eines Hörbuch-Runs. */
  msPerChar: number | null;
  samplesCount: number;
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
  };
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
  filename: string; // originaler Dateiname, nur für Extension
  bytes: Uint8Array;
}

export interface CreateVoiceSampleResult {
  sample: VoiceSample;
}

/** Erstellt einen neuen Voice-Sample-Eintrag. Wirft bei ungültiger
 *  Erweiterung oder zu großer Datei. */
export function createVoiceSample(
  input: CreateVoiceSampleInput
): CreateVoiceSampleResult {
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

  ensureDir();
  const id = randomUUID();
  const refPath = join(VOICE_DIR, `${id}${ext}`);
  writeFileSync(refPath, input.bytes);

  // 31-bit positive int — passt in SQLite INTEGER und Python
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
      input.bytes.byteLength,
      0 // Dauer ermitteln wir nicht — wäre ein ffprobe-Subprocess pro Upload
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

/** Lädt die Referenz-Audio-Bytes vom Disk. Wird von der qwen-Engine
 *  vor jedem Synthese-Call aufgerufen. */
export function readVoiceRefBytes(sample: VoiceSample): Buffer {
  if (!existsSync(sample.refPath)) {
    throw new Error(
      `voice sample ${sample.id} file missing at ${sample.refPath}`
    );
  }
  return readFileSync(sample.refPath);
}

/** EMA-Update für die Synthese-Geschwindigkeit einer Voice.
 *
 *  Formel: ms_per_char_new = alpha * (elapsed / chars) + (1 - alpha) * old
 *  alpha = 0.2 → ein neuer Datenpunkt wiegt 20 %, die Historie 80 %.
 *  Das glättet Ausreißer (gelegentlich hängender Chunk) ohne dass
 *  Messpunkte jahrelang nachhallen.
 *
 *  Erster Datenpunkt: ms_per_char wird direkt gesetzt, ohne EMA-Mix. */
export function recordChunkTiming(
  voiceId: string,
  chars: number,
  elapsedMs: number
): void {
  if (chars < 50 || elapsedMs < 100) return; // zu kleine Samples sind rauschig
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
