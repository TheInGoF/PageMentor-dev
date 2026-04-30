/**
 * Voice design service — text-described voices for the Qwen3-TTS
 * VoiceDesign model.
 *
 * Unlike `voice_samples` (user uploads ref.wav), this stores a
 * free-text prompt in the `description` DB field, e.g.:
 *
 *   "Warm German audiobook narrator, early 40s, calm unhurried
 *    delivery, clear German pronunciation without accent."
 *
 * The sidecar passes this description as the `instruct` parameter to
 * `generate_voice_design()`; the model produces the matching voice.
 *
 * Seed: rolled once on create, constant afterwards. Same seed + same
 * description empirically reproduces the same voice (Qwen doesn't
 * officially document determinism here, but `torch.manual_seed` in
 * the sidecar takes effect).
 */

import { randomUUID, randomInt } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";
const DESIGN_DIR = join(DATA_DIR, "voice-designs");

export function ensureDesignDir(): void {
  if (!existsSync(DESIGN_DIR)) mkdirSync(DESIGN_DIR, { recursive: true });
}

/** Returns the disk path for the reference audio file and ensures
 *  the directory exists — callers can directly do
 *  `writeFileSync(designRefPath(id), buf)` without risking ENOENT on
 *  fresh installs. */
export function designRefPath(id: string): string {
  ensureDesignDir();
  return join(DESIGN_DIR, `${id}.mp3`);
}

export type Gender = "female" | "male";

export interface VoiceDesign {
  id: string;
  label: string;
  gender: Gender;
  language: string;
  description: string;
  seed: number;
  createdAt: string;
  msPerChar: number | null;
  samplesCount: number;
  /** Path to the reference audio on disk. Empty when never
   *  generated — the caller must then invoke `ensureDesignReference`
   *  before the voice can be used for clone-based synthesis. */
  refPath: string | null;
  /** Transcript of the reference audio (passed as ref_text to base
   *  clone, improves clone quality). */
  refText: string | null;
  /** Whether this voice appears in the audiobook tab's voice picker. */
  showInAudiobook: boolean;
}

interface Row {
  id: string;
  label: string;
  gender: string;
  language: string;
  description: string;
  seed: number;
  created_at: string;
  ms_per_char: number | null;
  samples_count: number;
  ref_path: string | null;
  ref_text: string | null;
  show_in_audiobook: number | null;
}

function rowToDesign(r: Row): VoiceDesign {
  return {
    id: r.id,
    label: r.label,
    gender: r.gender === "male" ? "male" : "female",
    language: r.language,
    description: r.description,
    seed: r.seed,
    createdAt: r.created_at,
    msPerChar: r.ms_per_char ?? null,
    samplesCount: r.samples_count ?? 0,
    refPath: r.ref_path ?? null,
    refText: r.ref_text ?? null,
    showInAudiobook: (r.show_in_audiobook ?? 1) === 1,
  };
}

/** Toggle the audiobook-picker visibility flag. */
export function setVoiceDesignVisibility(id: string, show: boolean): boolean {
  const res = db()
    .prepare("UPDATE voice_designs SET show_in_audiobook = ? WHERE id = ?")
    .run(show ? 1 : 0, id);
  return res.changes > 0;
}

export function listVoiceDesigns(): VoiceDesign[] {
  const rows = db()
    .prepare("SELECT * FROM voice_designs ORDER BY created_at DESC")
    .all() as Row[];
  return rows.map(rowToDesign);
}

export function getVoiceDesign(id: string): VoiceDesign | null {
  const r = db().prepare("SELECT * FROM voice_designs WHERE id = ?").get(id) as
    | Row
    | undefined;
  return r ? rowToDesign(r) : null;
}

export interface CreateVoiceDesignInput {
  label: string;
  gender: Gender;
  language?: string;
  description: string;
  /** Optional: seed supplied by the user (for "give me the same
   *  voice I had before, I remember the seed").
   *  Empty = random. */
  seed?: number;
}

export function createVoiceDesign(
  input: CreateVoiceDesignInput
): { design: VoiceDesign } {
  const label = input.label.trim();
  if (!label) throw new Error("label required");
  const description = input.description.trim();
  if (description.length < 10) {
    throw new Error("description too short (at least 10 characters)");
  }
  if (description.length > 2000) {
    throw new Error("description too long (maximum 2000 characters)");
  }

  const id = randomUUID();
  const seed =
    input.seed !== undefined && Number.isFinite(input.seed) && input.seed > 0
      ? Math.floor(input.seed)
      : randomInt(1, 2 ** 31 - 1);

  db()
    .prepare(
      `INSERT INTO voice_designs (id, label, gender, language, description, seed)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, label, input.gender, input.language ?? "de", description, seed);

  const design = getVoiceDesign(id);
  if (!design) throw new Error("voice design vanished right after insert");
  return { design };
}

export function deleteVoiceDesign(id: string): boolean {
  const design = getVoiceDesign(id);
  if (!design) return false;
  // Also delete the reference audio, otherwise we leave orphan
  // MP3 files on disk.
  if (design.refPath && existsSync(design.refPath)) {
    try {
      unlinkSync(design.refPath);
    } catch (e) {
      console.warn(`[voice-designs] failed to unlink ${design.refPath}:`, e);
    }
  }
  const r = db().prepare("DELETE FROM voice_designs WHERE id = ?").run(id);
  return r.changes > 0;
}

/** Persists a freshly generated reference audio path + transcript
 *  on the design row. Called after a successful VoiceDesign generate
 *  call (in the create flow, or lazily on first audiobook use). */
export function setDesignReference(
  id: string,
  refPath: string,
  refText: string
): void {
  ensureDesignDir();
  db()
    .prepare(
      "UPDATE voice_designs SET ref_path = ?, ref_text = ? WHERE id = ?"
    )
    .run(refPath, refText, id);
}

/** EMA update analogous to voiceSamples.recordChunkTiming — the
 *  frontend uses ms_per_char as the starting value for the audiobook
 *  ETA. */
export function recordDesignChunkTiming(
  designId: string,
  chars: number,
  elapsedMs: number
): void {
  if (chars < 50 || elapsedMs < 100) return;
  const design = getVoiceDesign(designId);
  if (!design) return;

  const newRate = elapsedMs / chars;
  const alpha = 0.2;
  const next =
    design.msPerChar === null
      ? newRate
      : alpha * newRate + (1 - alpha) * design.msPerChar;

  db()
    .prepare(
      "UPDATE voice_designs SET ms_per_char = ?, samples_count = samples_count + 1 WHERE id = ?"
    )
    .run(next, designId);
}
