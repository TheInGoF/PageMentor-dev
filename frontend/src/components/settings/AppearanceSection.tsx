// Erscheinungsbild: Hell, Dunkel oder wie Windows, Akzentfarbe
import { useState } from "react";
import { t } from "../../lib/i18n";
import { PALETTES, setThemePrefs, themePrefs, type Palette, type ThemeMode } from "../../lib/theme";
import { cn } from "../../lib/cn";
import { Card, SettingRow } from "./parts";

const MODES: ThemeMode[] = ["system", "light", "dark"];
const SWATCH: Record<Palette, string> = { sky: "#0066e0", sage: "#1c7a5a", amber: "#a85600" };

export function AppearanceSection() {
  const [prefs, setPrefs] = useState(themePrefs());
  const update = (patch: Partial<typeof prefs>) => setPrefs(setThemePrefs(patch));

  return (
    <Card title={t("settings.section.appearance")}>
      <SettingRow label={t("general.mode")}>
        <select className="input w-full" value={prefs.mode} onChange={(e) => update({ mode: e.target.value as ThemeMode })}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {t(`settings.theme.${m}`)}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t("general.accent")} hint={t(`settings.palette.${prefs.palette}`)}>
        {/* Farbpunkte statt Knöpfe mit Text: passt in die Bedienspalte */}
        <div className="flex gap-2">
          {PALETTES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => update({ palette: p })}
              title={t(`settings.palette.${p}`)}
              aria-label={t(`settings.palette.${p}`)}
              aria-pressed={prefs.palette === p}
              className={cn("w-8 h-8 rounded-full border-2", prefs.palette === p ? "border-neutral-100" : "border-transparent")}
              style={{ background: SWATCH[p] }}
            />
          ))}
        </div>
      </SettingRow>
    </Card>
  );
}
