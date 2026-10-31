// Standardstimmen je Sprache mit gemeinsamer Stimmlage: Haupt- und Zweitstimme zweisprachiger Bücher passen so zusammen.
// Speichert sofort; ohne eigene Wahl nimmt die App die beste Stimme der Sprache in der gewählten Stimmlage
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { VoiceDefaults } from "../../lib/api/audio";
import type { Voice } from "../../lib/api/types";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";
import { SettingRow } from "./parts";

const LANGS = ["de", "en", "es"] as const;
const GENDERS = ["female", "male", ""] as const;

export function VoiceDefaultsRows({ voices }: { voices: Voice[] }) {
  const [prefs, setPrefs] = useState<VoiceDefaults | null>(null);

  useEffect(() => {
    void api.audio.voiceDefaults().then(setPrefs).catch(() => setPrefs(null));
  }, []);

  if (!prefs) return null;
  const byId = (id: string) => voices.find((v) => v.id === id);
  const save = async (body: Parameters<typeof api.audio.setVoiceDefaults>[0]) => setPrefs(await api.audio.setVoiceDefaults(body));

  // Neue Stimmlage: eigene Wahl, die nicht passt, zurück auf automatisch
  const setGender = (gender: VoiceDefaults["gender"]) => {
    const byLang = Object.fromEntries(
      Object.entries(prefs.byLang).map(([lang, id]) => [lang, gender && byId(id)?.gender !== gender ? "" : id])
    );
    void save({ gender, byLang });
  };

  return (
    <>
      <SettingRow label={t("voiceDefaults.gender")} hint={t("voiceDefaults.genderHint")}>
        <div className="flex gap-2">
          {GENDERS.map((g) => (
            <button key={g || "any"} type="button" className={cn("chip flex-1", prefs.gender === g && "chip-active")} onClick={() => setGender(g)}>
              {t(`voiceDefaults.gender.${g || "any"}`)}
            </button>
          ))}
        </div>
      </SettingRow>
      {LANGS.map((lang) => {
        const list = voices.filter((v) => v.language === lang);
        if (!list.length) return null;
        // Passende Stimmlage zuerst
        const sorted = [...list].sort((a, b) => Number(!!prefs.gender && a.gender !== prefs.gender) - Number(!!prefs.gender && b.gender !== prefs.gender));
        const auto = byId(prefs.effective[lang]);
        return (
          <SettingRow key={lang} label={t(`voiceDefaults.lang.${lang}`)}>
            <select className="input w-full" value={prefs.byLang[lang] ?? ""} onChange={(e) => void save({ byLang: { [lang]: e.target.value } })}>
              <option value="">{t("voiceDefaults.auto", { voice: auto ? auto.label : "–" })}</option>
              {sorted.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {t(`audiobook.engine.${v.engine}`)} · {t(`voiceDefaults.gender.${v.gender}`)}
                </option>
              ))}
            </select>
          </SettingRow>
        );
      })}
    </>
  );
}
