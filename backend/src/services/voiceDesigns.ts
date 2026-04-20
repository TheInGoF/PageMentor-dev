/**
 * Voice-Design-Service — text-beschriebene Stimmen für Qwen3-TTS
 * VoiceDesign-Modell.
 *
 * Anders als `voice_samples` (User lädt ref.wav hoch) steht hier ein
 * Freitext-Prompt im DB-Feld `description`, z. B.:
 *
 *   "Warmer deutscher Hörbuch-Erzähler, Anfang 40, ruhige gemächliche
 *    Sprechweise, klare deutsche Aussprache ohne Akzent."
 *
 * Der Sidecar übergibt diese Beschreibung als `instruct`-Parameter an
 * `generate_voice_design()`; das Modell erzeugt die passende Stimme.
 *
 * Seed: beim Create einmalig gewürfelt, konstant. Gleicher Seed +
 * gleiche Beschreibung reproduzieren empirisch dieselbe Stimme (Qwen
 * dokumentiert Determinismus hier nicht offiziell, aber `torch.manual_seed`
 * im Sidecar greift).
 */

import { randomUUID, randomInt } from "node:crypto";
import { db } from "../db";

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
  };
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
  /** Optional: Seed vom User vorgegeben (für "gib mir genau dieselbe
   *  Stimme die ich schon mal hatte, ich weiß noch den Seed").
   *  Leer = random. */
  seed?: number;
}

export function createVoiceDesign(
  input: CreateVoiceDesignInput
): { design: VoiceDesign } {
  const label = input.label.trim();
  if (!label) throw new Error("label required");
  const description = input.description.trim();
  if (description.length < 10) {
    throw new Error("description zu kurz (mindestens 10 Zeichen)");
  }
  if (description.length > 2000) {
    throw new Error("description zu lang (maximal 2000 Zeichen)");
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
  const r = db().prepare("DELETE FROM voice_designs WHERE id = ?").run(id);
  return r.changes > 0;
}

/** EMA-Update analog zu voiceSamples.recordChunkTiming — Frontend nutzt
 *  ms_per_char als Startwert für die Hörbuch-ETA. */
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
