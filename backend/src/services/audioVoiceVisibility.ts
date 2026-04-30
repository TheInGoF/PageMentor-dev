/**
 * Audiobook voice-picker visibility policy.
 *
 * The voice picker in the audiobook tab can drown in candidates: 9
 * built-in CustomVoice presets × 2 languages, plus N user voice
 * samples, plus M designed voices. We let users hide voices they
 * don't intend to narrate with so the dropdown stays usable.
 *
 *   - voice_samples / voice_designs:  per-row `show_in_audiobook`
 *     column (default 1). Toggled directly via the row-level
 *     PATCH endpoint.
 *   - preset voices: stored as a comma-separated list in
 *     `llmConfig.hiddenAudiobookPresets`. Default-hidden set covers
 *     the ZH/JP/KR-native presets (Vivian, Uncle_Fu, Sicheng,
 *     Sunny, Ono_Anna, Ana, …) — they're not flagship for German
 *     audiobooks and crowd the dropdown.
 */

import { effective } from "./llmConfig";
import { listPresetVoices } from "../tts/presetVoices";

/** Preset IDs hidden by default unless the user opts them in. The
 *  flagship DE/EN presets (Ryan, Aiden) are visible by default; the
 *  rest stays out of the audiobook picker until explicitly enabled. */
const DEFAULT_HIDDEN_PRESETS: ReadonlySet<string> = new Set([
  "preset:Vivian",
  "preset:Uncle_Fu",
  "preset:Sicheng",
  "preset:Sunny",
  "preset:Ono_Anna",
  "preset:Ana",
  "preset:Cherry",
]);

/** Resolves the user-configured override for hidden presets. Falls
 *  back to the default-hidden set when the config is empty (first
 *  install). When the user has saved an explicit list — even an
 *  empty one — it overrides the default entirely so they can opt
 *  every preset back in. */
export function hiddenPresetIds(): Set<string> {
  const raw = effective("hiddenAudiobookPresets", "PM_HIDDEN_AUDIOBOOK_PRESETS");
  if (raw === undefined) return new Set(DEFAULT_HIDDEN_PRESETS);
  // Empty string is meaningful: "the user said all presets visible".
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

/** True iff this preset voice ID should appear in the audiobook
 *  picker right now. */
export function isPresetVisible(voiceId: string): boolean {
  return !hiddenPresetIds().has(voiceId);
}

/** Convenience: every preset voice paired with its current
 *  visibility flag. Used by the Settings page so the user can see
 *  the full list and toggle individual presets. */
export function listPresetVisibility(): Array<{
  voice: ReturnType<typeof listPresetVoices>[number];
  visible: boolean;
}> {
  const hidden = hiddenPresetIds();
  return listPresetVoices().map((v) => ({
    voice: v,
    visible: !hidden.has(v.id),
  }));
}
