// Gesamter Zustand der Einstellungen für die Abschnitte
import type { SettingsCore } from "./useSettingsCore";
import type { VoiceManager } from "./useVoiceManager";
import type { PresetTester } from "./usePresetTester";

export type SettingsState = SettingsCore & VoiceManager & PresetTester;
