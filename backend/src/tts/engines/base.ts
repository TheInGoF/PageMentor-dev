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
