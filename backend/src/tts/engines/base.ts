/**
 * Gemeinsames Interface für TTS-Engines.
 *
 * Jede Engine meldet zur Laufzeit, ob sie verfügbar ist. Qwen pingt
 * den Arbiter. `listVoices()` darf bei Async-Engines synchronen Cache
 * liefern, der im Hintergrund aktualisiert wird (siehe qwen.ts).
 */

import type { Segment } from "../segment";

export type EngineId = "qwen";

export interface Voice {
  id: string;
  label: string;
  language: string;        // "de", "en"
  locale: string;          // "de-DE", "en-US"
  gender: "female" | "male";
  engine: EngineId;
  flagship?: boolean;
  note?: string;
  /** Gleitender Durchschnitt der Synthese-Dauer pro Zeichen (ms/char).
   *  `null` wenn noch keine Messpunkte vorliegen. Genutzt vom Frontend
   *  für die initiale ETA-Schätzung eines Hörbuch-Runs. */
  msPerChar?: number | null;
}

export interface SynthesizeParams {
  segment: Segment;
  text: string;             // vorbereiteter Plain-Text (für Engines ohne SSML)
  voice: Voice;
  locale: string;           // Engine-spezifisches Locale-Format
  rate: string;             // "+0%", "-10%" … (nur Edge nutzt es)
  announce?: string;        // Kapitel-Ansage als erster Satz
  outPath: string;
}

export interface SynthesizeResult {
  path: string;
  bytes: number;
}

export interface PreviewParams {
  voice: Voice;
  locale: string;
  text: string;
  /** Pro-Request-Override des globalen Qwen-TTS-Instruction-Prompts.
   *  Wird vom Settings-Preset-Tester genutzt, damit der User unsaved
   *  Instruction-Änderungen anhören kann bevor er speichert. Nur für
   *  CustomVoice-Presets relevant; Voice-Clone-Pfad ignoriert. */
  instructOverride?: string;
  /** Sampling-Dial-Overrides für den Tester — erlaubt das Probieren
   *  verschiedener temperature/top_p/seed-Werte ohne sie vorher in
   *  llm-config zu persistieren. `undefined` = Config-Default benutzen. */
  temperatureOverride?: number;
  topPOverride?: number;
  maxNewTokensOverride?: number;
  seedOverride?: number;
}

export interface TtsEngine {
  id: EngineId;
  /** Engines mit Sidecar (Qwen) melden hier `false`, wenn der
   *  Sidecar beim letzten Discovery-Refresh nicht antwortete.
   *  Netz-basierte Engines (Edge) melden immer `true` und fallen erst
   *  reaktiv um, wenn der Server stumm Empty-Audio liefert. */
  isAvailable(): boolean;
  listVoices(): Voice[];
  synthesize(params: SynthesizeParams): Promise<SynthesizeResult>;
  preview(params: PreviewParams): Promise<Buffer>;
}
