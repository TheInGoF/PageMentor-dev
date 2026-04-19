/**
 * Voice-Katalog — kombiniert Qwen3-TTS-Flash (Default, self-hosted
 * lokal via pm-qwen-tts + pm-gpu-arbiter) und Microsoft Edge Neural
 * Voices (Cloud-Fallback, kein Setup, gratis).
 *
 * Default-Provider ist Qwen: Apache-2.0-Modell, multilingual, spricht
 * Deutsch nativ, läuft offline in einem eigenen Sidecar-Container und
 * teilt sich die GPU mit Ollama über den Arbiter (automatischer
 * Wechsel je nach Anfrage). Frei einsetzbar für Hochschulen und Firmen.
 *
 * Edge bleibt als Zweit-Provider verfügbar — Microsoft Neural Voices
 * sind exzellent, kosten nichts und brauchen keine Konfiguration,
 * schicken den Text aber an Azure. Für reine Mac-/CPU-Dev-Umgebungen
 * ohne GPU-Sidecar-Stack ist Edge der praktische Fallback.
 *
 * `defaultVoiceFor()` wählt in dieser Reihenfolge:
 *   1. Qwen-Flagship in Ziel-Sprache (wenn Sidecar antwortet)
 *   2. irgendeine Qwen-Voice in Ziel-Sprache
 *   3. Edge-Flagship in Ziel-Sprache
 *   4. irgendeine Voice in Ziel-Sprache
 *   5. erste Voice überhaupt
 */

import { edgeEngine } from "./engines/edge";
import { qwenEngine } from "./engines/qwen";
import type { EngineId, TtsEngine, Voice } from "./engines/base";

export type { EngineId, Voice } from "./engines/base";
export type TtsEngineType = EngineId;

// Reihenfolge bestimmt den Default-Picker — Qwen zuerst.
const ENGINES: TtsEngine[] = [qwenEngine, edgeEngine];

export function engineFor(id: EngineId): TtsEngine | undefined {
  return ENGINES.find((e) => e.id === id);
}

export function allVoices(): Voice[] {
  return ENGINES.flatMap((e) => (e.isAvailable() ? e.listVoices() : []));
}

export function defaultVoiceFor(language: string): string {
  // Qwen bevorzugen, wenn der Sidecar/Arbiter lebt und eine passende
  // Voice hat.
  if (qwenEngine.isAvailable()) {
    const qwenVoices = qwenEngine.listVoices();
    const flagship = qwenVoices.find(
      (v) => v.language === language && v.flagship
    );
    if (flagship) return flagship.id;
    const any = qwenVoices.find((v) => v.language === language);
    if (any) return any.id;
  }
  // Fallback: Edge.
  const all = allVoices();
  const flagship = all.find((v) => v.language === language && v.flagship);
  if (flagship) return flagship.id;
  const any = all.find((v) => v.language === language);
  return any?.id ?? all[0]?.id ?? "";
}

export function findVoice(id: string): Voice | undefined {
  return allVoices().find((v) => v.id === id);
}
