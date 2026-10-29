// Allgemein: Sprache und Vorgaben für Upload und Probeklausur; Dienste-Status steht unter Engine
import { type Settings } from "../../lib/settings";
import { LOCALE_LABELS, t, type Locale } from "../../lib/i18n";
import type { SettingsState } from "./state";
import { Card, SettingRow } from "./parts";

export function GeneralSection({ st }: { st: SettingsState }) {
  const { s, setS } = st;
  const num = (v: string, min: number, fallback: number) => Math.max(min, Number(v) || fallback);
  return (
    <Card title={t("general.defaults")}>
      <SettingRow label={t("settings.locale")}>
        <select className="input w-full" value={s.locale || ""} onChange={(e) => setS({ ...s, locale: (e.target.value || "") as Locale | "" })}>
          <option value="">Auto</option>
          {(Object.keys(LOCALE_LABELS) as Locale[]).map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t("settings.defaultLanguage")} hint={t("general.uploadLanguageHint")}>
        <select className="input w-full" value={s.defaultLanguage} onChange={(e) => setS({ ...s, defaultLanguage: e.target.value as Settings["defaultLanguage"] })}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </SettingRow>
      <SettingRow label={t("settings.defaultExamCount")}>
        <input className="input w-full" type="number" min={1} max={200} value={s.defaultExamCount} onChange={(e) => setS({ ...s, defaultExamCount: num(e.target.value, 1, 20) })} />
      </SettingRow>
      <SettingRow label={t("settings.defaultExamMinutes")}>
        <input className="input w-full" type="number" min={0} max={600} value={s.defaultExamMinutes} onChange={(e) => setS({ ...s, defaultExamMinutes: num(e.target.value, 0, 0) })} />
      </SettingRow>
    </Card>
  );
}
