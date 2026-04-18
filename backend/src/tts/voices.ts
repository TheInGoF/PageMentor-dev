/**
 * Voice-Katalog — kombiniert lokales Kokoro (Default) und Microsoft
 * Edge Neural Voices (Cloud-Fallback, kein Setup, gratis).
 *
 * Default-Provider ist Kokoro: Apache-2.0-Modell, läuft offline im
 * eigenen Sidecar-Container, klingt natürlich genug für lange
 * wissenschaftliche Hörbücher und ist auch für Hochschulen und
 * Firmen empfehlbar (keine Cloud-Abhängigkeit, keine Lizenz-
 * Stolperfallen).
 *
 * Edge bleibt als Zweit-Provider verfügbar — Microsoft Neural Voices
 * sind exzellent, kosten nichts und brauchen keine Konfiguration,
 * schicken den Text aber an Azure. Wer das vermeiden will, lässt
 * Kokoro Default und ignoriert Edge.
 *
 * `defaultVoiceFor()` wählt in dieser Reihenfolge:
 *   1. Kokoro-Flagship in Ziel-Sprache (wenn Sidecar antwortet)
 *   2. irgendeine Kokoro-Voice in Ziel-Sprache
 *   3. Edge-Flagship in Ziel-Sprache
 *   4. irgendeine Voice in Ziel-Sprache
 *   5. erste Voice überhaupt
 */

import { edgeEngine } from "./engines/edge";
import { kokoroEngine } from "./engines/kokoro";
import type { EngineId, TtsEngine, Voice } from "./engines/base";

export type { EngineId, Voice } from "./engines/base";
export type TtsEngineType = EngineId;

// Reihenfolge bestimmt den Default-Picker — Kokoro zuerst.
const ENGINES: TtsEngine[] = [kokoroEngine, edgeEngine];

export function engineFor(id: EngineId): TtsEngine | undefined {
  return ENGINES.find((e) => e.id === id);
}

export function allVoices(): Voice[] {
  return ENGINES.flatMap((e) => (e.isAvailable() ? e.listVoices() : []));
}

export function defaultVoiceFor(language: string): string {
  // Kokoro bevorzugen, wenn der Sidecar lebt und eine passende Voice
  // hat — egal ob als Flagship markiert oder nicht.
  if (kokoroEngine.isAvailable()) {
    const kokoroVoices = kokoroEngine.listVoices();
    const flagship = kokoroVoices.find(
      (v) => v.language === language && v.flagship
    );
    if (flagship) return flagship.id;
    const any = kokoroVoices.find((v) => v.language === language);
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
