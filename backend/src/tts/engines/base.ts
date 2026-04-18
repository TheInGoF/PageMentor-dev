/**
 * Gemeinsames Interface für alle TTS-Engines.
 *
 * Jede Engine meldet zur Laufzeit, ob sie verfügbar ist (Piper hat
 * z. B. Voice-Dateien gefunden, Edge kann den Websocket erreichen —
 * Letzteres prüfen wir nicht proaktiv, nur reaktiv via Fallback),
 * liefert ihren Teil des Voice-Katalogs und kann ein Segment oder ein
 * kurzes Preview synthetisieren.
 */

import type { Segment } from "../segment";

export type EngineId = "edge";

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
  /** Engines, die Assets im Dateisystem brauchen (Piper), melden hier
   *  `false`, wenn nichts gefunden wurde. Netz-basierte Engines (Edge)
   *  melden immer `true` und fallen zur Laufzeit um. */
  isAvailable(): boolean;
  listVoices(): Voice[];
  synthesize(params: SynthesizeParams): Promise<SynthesizeResult>;
  preview(params: PreviewParams): Promise<Buffer>;
}
