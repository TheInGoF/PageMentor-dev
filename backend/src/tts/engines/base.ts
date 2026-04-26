/**
 * Shared interface for TTS engines.
 *
 * Each engine reports at runtime whether it is available. Qwen pings
 * the arbiter. `listVoices()` may return a synchronous cache for async
 * engines that gets refreshed in the background (see qwen.ts).
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
  /** Rolling average of synthesis duration per character (ms/char).
   *  `null` when no measurements exist yet. Used by the frontend
   *  for the initial ETA estimate of an audiobook run. */
  msPerChar?: number | null;
}

export interface SynthesizeParams {
  segment: Segment;
  text: string;             // prepared plain text (for engines without SSML)
  voice: Voice;
  locale: string;           // engine-specific locale format
  rate: string;             // "+0%", "-10%" … (only Edge uses it)
  announce?: string;        // chapter announcement as first sentence
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
  /** Per-request override of the global Qwen-TTS instruction prompt.
   *  Used by the settings preset tester so the user can preview
   *  unsaved instruction changes before saving. Only relevant for
   *  CustomVoice presets; ignored on the voice-clone path. */
  instructOverride?: string;
  /** Sampling dial overrides for the tester — allows trying different
   *  temperature/top_p/seed values without persisting them in
   *  llm-config first. `undefined` = use the config default. */
  temperatureOverride?: number;
  topPOverride?: number;
  maxNewTokensOverride?: number;
  seedOverride?: number;
}

export interface TtsEngine {
  id: EngineId;
  /** Engines with a sidecar (Qwen) report `false` here when the
   *  sidecar didn't respond on the last discovery refresh.
   *  Network-based engines (Edge) always report `true` and only flip
   *  reactively when the server silently returns empty audio. */
  isAvailable(): boolean;
  listVoices(): Voice[];
  synthesize(params: SynthesizeParams): Promise<SynthesizeResult>;
  preview(params: PreviewParams): Promise<Buffer>;
}
