import { useEffect, useState } from "react";
import { getSettings, onSettingsChange, setSettings } from "./settings";
import { en } from "./locales/en";
import { de } from "./locales/de";

export type Locale = "en" | "de";

// Sprache: Einstellung > Browser (de-*) > Englisch
export function detectInitialLocale(): Locale {
  const fromSettings = getSettings().locale;
  if (fromSettings === "en" || fromSettings === "de") return fromSettings;
  if (typeof navigator !== "undefined") {
    const langs = [navigator.language, ...(navigator.languages ?? [])];
    for (const l of langs) {
      if (l && l.toLowerCase().startsWith("de")) return "de";
    }
  }
  return "en";
}

export function currentLocale(): Locale {
  return detectInitialLocale();
}

export function setLocale(l: Locale): void {
  setSettings({ locale: l });
  document.documentElement.lang = l;
}

// Hook: neu rendern bei Sprachwechsel
export function useLocale(): Locale {
  const [l, set] = useState<Locale>(currentLocale());
  useEffect(() => {
    const unsub = onSettingsChange(() => set(currentLocale()));
    set(currentLocale());
    return unsub;
  }, []);
  return l;
}

// Key übersetzen, Platzhalter wie {count} ersetzen
export function t(key: string, params?: Record<string, string | number>): string {
  const locale = currentLocale();
  const s = dicts[locale][key] ?? dicts.en[key] ?? key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    return v == null ? `{${k}}` : String(v);
  });
}

// Sprachnamen fürs Dropdown, nie übersetzt
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};

const dicts: Record<Locale, Record<string, string>> = { en, de };
