/**
 * Kleine localStorage-basierte Settings. Keine Backend-Route nötig —
 * Defaults sind pro Browser/Benutzer.
 */

const KEY = "pagementor.settings.v1";

export interface Settings {
  locale: "en" | "de" | "";      // "" = follow browser / default en
  defaultLanguage: "de" | "en";  // default upload language
  defaultVoice: string;          // voice id
  defaultRate: string;           // "+0%" … "+30%"
  defaultOllamaModel: string;    // leer = Server-Default
  defaultExamCount: number;
  defaultExamMinutes: number;
}

const DEFAULTS: Settings = {
  locale: "",
  defaultLanguage: "en",
  defaultVoice: "",
  defaultRate: "+0%",
  defaultOllamaModel: "",
  defaultExamCount: 20,
  defaultExamMinutes: 60,
};

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage might be full or disabled — ignore
  }
  notify(next);
  return next;
}

type Handler = (s: Settings) => void;
const handlers = new Set<Handler>();

export function onSettingsChange(h: Handler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}

function notify(s: Settings) {
  for (const h of handlers) h(s);
}
