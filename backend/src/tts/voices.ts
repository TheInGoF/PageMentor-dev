/**
 * Kuratierte High-Quality Neural Voices aus der Azure Speech Service
 * (via Microsoft Edge Read-Aloud-API). Die *MultilingualNeural*-Stimmen
 * sind Microsofts neueste Generation mit sehr natürlicher Prosodie.
 *
 * Rate/Pitch-Defaults sind bewusst auf "natürlich" eingestellt.
 */

export interface Voice {
  id: string;              // ShortName für Azure
  label: string;           // Anzeigename
  language: string;        // "de", "en"
  locale: string;          // "de-DE", "en-US"
  gender: "female" | "male";
  flagship?: boolean;      // Top-Empfehlung für die Sprache
  note?: string;
}

export const VOICES: Voice[] = [
  // Deutsch — Multilingual (neueste Generation)
  {
    id: "de-DE-SeraphinaMultilingualNeural",
    label: "Seraphina (DE, Multilingual)",
    language: "de",
    locale: "de-DE",
    gender: "female",
    flagship: true,
    note: "Warme, klare Vorlesestimme — Studio-Qualität.",
  },
  {
    id: "de-DE-FlorianMultilingualNeural",
    label: "Florian (DE, Multilingual)",
    language: "de",
    locale: "de-DE",
    gender: "male",
    flagship: true,
    note: "Ruhige, männliche Vorlesestimme mit exzellenter Prosodie.",
  },
  {
    id: "de-DE-KatjaNeural",
    label: "Katja (DE)",
    language: "de",
    locale: "de-DE",
    gender: "female",
  },
  {
    id: "de-DE-ConradNeural",
    label: "Conrad (DE)",
    language: "de",
    locale: "de-DE",
    gender: "male",
  },
  {
    id: "de-AT-IngridNeural",
    label: "Ingrid (AT)",
    language: "de",
    locale: "de-AT",
    gender: "female",
  },
  {
    id: "de-CH-LeniNeural",
    label: "Leni (CH)",
    language: "de",
    locale: "de-CH",
    gender: "female",
  },

  // English — Multilingual (neueste Generation)
  {
    id: "en-US-AvaMultilingualNeural",
    label: "Ava (US, Multilingual)",
    language: "en",
    locale: "en-US",
    gender: "female",
    flagship: true,
    note: "Microsoft flagship voice — natural, expressive.",
  },
  {
    id: "en-US-AndrewMultilingualNeural",
    label: "Andrew (US, Multilingual)",
    language: "en",
    locale: "en-US",
    gender: "male",
    flagship: true,
  },
  {
    id: "en-US-EmmaMultilingualNeural",
    label: "Emma (US, Multilingual)",
    language: "en",
    locale: "en-US",
    gender: "female",
  },
  {
    id: "en-US-BrianMultilingualNeural",
    label: "Brian (US, Multilingual)",
    language: "en",
    locale: "en-US",
    gender: "male",
  },
  {
    id: "en-GB-SoniaNeural",
    label: "Sonia (UK)",
    language: "en",
    locale: "en-GB",
    gender: "female",
  },
  {
    id: "en-GB-RyanNeural",
    label: "Ryan (UK)",
    language: "en",
    locale: "en-GB",
    gender: "male",
  },
];

export function defaultVoiceFor(language: string): string {
  const v = VOICES.find((v) => v.language === language && v.flagship);
  return v?.id ?? VOICES[0].id;
}

export function findVoice(id: string): Voice | undefined {
  return VOICES.find((v) => v.id === id);
}
