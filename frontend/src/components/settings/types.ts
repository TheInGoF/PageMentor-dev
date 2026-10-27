// Gemeinsame Typen und Konstanten der Einstellungen
export interface LlmConfig {
  ollamaUrlPc?: string;
  ollamaUrlMac?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  teiUrl?: string;
  anthropicModel?: string;
  anthropicApiKeyPresent?: boolean;
  openaiModel?: string;
  openaiApiKeyPresent?: boolean;
  googleModel?: string;
  googleApiKeyPresent?: boolean;
  qwenTtsUrl?: string;
  qwenTtsApiKeyPresent?: boolean;
  qwenTtsInstruction?: string;
  absEnabled?: string;
  absUrl?: string;
  absApiKeyPresent?: boolean;
  absLibraryId?: string;
  qwenTtsTemperature?: string;
  qwenTtsTopP?: string;
  qwenTtsTopK?: string;
  qwenTtsRepetitionPenalty?: string;
  ttsMaxChunk?: string;
}


// Kacheln der Übersicht, "home" ist die Übersicht selbst
export type SettingsTab = "home" | "ai" | "voices" | "engine" | "general" | "diagnose";

/** Event name for "voice list has changed" — other components
 *  (audiobook picker) listen for it and reload voices. */
export const VOICES_CHANGED_EVENT = "pm:voices-changed";

export function notifyVoicesChanged(): void {
  window.dispatchEvent(new Event(VOICES_CHANGED_EVENT));
}


/** 5%-Schritte von -10 bis +30 — programmatisch, damit das Label-Set
 *  konsistent zu Audiobook.tsx bleibt. */
export const RATES: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let pct = -10; pct <= 30; pct += 5) {
    if (pct === 0) out.push({ value: "+0%", label: "Normal" });
    else if (pct > 0) out.push({ value: `+${pct}%`, label: `+${pct} %` });
    else out.push({ value: `${pct}%`, label: `−${Math.abs(pct)} %` });
  }
  return out;
})();
