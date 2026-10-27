// Referenz-Audio für Design-Stimmen
import { existsSync, unlinkSync, writeFileSync } from "fs";
import {
  designRefPath,
  setDesignReference,
  type VoiceDesign,
} from "../../../services/voiceDesigns";
import { readDials, type AdvancedDials } from "./config";
import { callSpeechDesign } from "./calls";

// Referenz-Audio einer Design-Stimme sicherstellen
// Fehlt sie: einmal per VoiceDesign erzeugen und speichern
export async function ensureDesignReference(
  design: VoiceDesign,
  timeoutMs: number = 3 * 60_000,
  force: boolean = false
): Promise<VoiceDesign> {
  if (!force && design.refPath && existsSync(design.refPath)) {
    return design;
  }
  // force: alte Referenz löschen und neu erzeugen
  if (force && design.refPath && existsSync(design.refPath)) {
    try {
      unlinkSync(design.refPath);
    } catch {
      // best effort
    }
  }

  // Referenztext für ~10 s Audio, ideal für den Speaker-Encoder
  // Kürzer führt zu Schleifen, länger bringt nichts
  // Ruhiger Satzbau: diesen Stil imitiert der Klon
  const refText =
    design.language === "de"
      ? "Hallo, dies ist eine Sprachprobe dieser Stimme. Sie wird beim Vorlesen ruhig und gleichmäßig gesprochen, damit der Klang über lange Passagen stabil bleibt."
      : "Hello, this is a voice sample. It is read calmly and evenly so the voice stays consistent across long passages of an audiobook.";

  console.log(
    `[qwen-tts] ensuring reference audio for design ${design.id} — generating via VoiceDesign (one-time)`
  );
  const buf = await previewDesignUnsaved({
    text: refText,
    description: design.description,
    gender: design.gender,
    language: design.language,
    seed: design.seed,
    timeoutMs,
  });
  const path = designRefPath(design.id);
  writeFileSync(path, buf);
  setDesignReference(design.id, path, refText);
  console.log(
    `[qwen-tts] design ${design.id} reference saved to ${path} (${buf.length} bytes)`
  );
  return { ...design, refPath: path, refText };
}

// Vorschau für ein noch nicht gespeichertes Design
// Standard-Regler aus der Config, wie beim späteren Hörbuch
export async function previewDesignUnsaved(params: {
  text: string;
  description: string;
  gender: "female" | "male";
  language: string;
  seed: number;
  timeoutMs: number;
  dials?: AdvancedDials;
}): Promise<Buffer> {
  const ephemeral: VoiceDesign = {
    id: "ephemeral-preview",
    label: "preview",
    gender: params.gender,
    language: params.language,
    description: params.description,
    seed: params.seed,
    createdAt: "",
    msPerChar: null,
    samplesCount: 0,
    refPath: null,
    refText: null,
    showInAudiobook: true,
  };
  return callSpeechDesign({
    text: params.text,
    design: ephemeral,
    timeoutMs: params.timeoutMs,
    dials: params.dials ?? readDials(),
  });
}
