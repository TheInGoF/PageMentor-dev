/**
 * Voice-Katalog — aggregiert alle verfügbaren Engines (Piper, Edge).
 *
 * Welche Stimmen am Ende im UI auftauchen, kommt aus:
 *   - Piper: Modelle im PM_PIPER_DIR; Multi-Speaker-Modelle werden pro
 *     Sprecher-Key aufgefaltet (siehe engines/piper.ts).
 *   - Edge: fester Katalog (engines/edge.ts).
 */

import { piperEngine } from "./engines/piper";
import { edgeEngine } from "./engines/edge";
import type { EngineId, TtsEngine, Voice } from "./engines/base";

export type { EngineId, Voice } from "./engines/base";
export type TtsEngineType = EngineId;

const ENGINES: TtsEngine[] = [piperEngine, edgeEngine];

export function engineFor(id: EngineId): TtsEngine | undefined {
  return ENGINES.find((e) => e.id === id);
}

export function allVoices(): Voice[] {
  return ENGINES.flatMap((e) => (e.isAvailable() ? e.listVoices() : []));
}

export function defaultVoiceFor(language: string): string {
  const voices = allVoices();
  // Edge-Flagship bevorzugen wenn vorhanden — die Qualität ist oft
  // merklich besser als Piper. Bei Edge-Ausfall zur Laufzeit schaltet
  // der Dispatcher automatisch auf Piper um.
  const edgeFlagship = voices.find(
    (v) => v.engine === "edge" && v.language === language && v.flagship
  );
  if (edgeFlagship) return edgeFlagship.id;
  const piperFlagship = voices.find(
    (v) => v.engine === "piper" && v.language === language && v.flagship
  );
  if (piperFlagship) return piperFlagship.id;
  const any = voices.find((v) => v.language === language);
  return any?.id ?? voices[0]?.id ?? "";
}

export function findVoice(id: string): Voice | undefined {
  return allVoices().find((v) => v.id === id);
}
