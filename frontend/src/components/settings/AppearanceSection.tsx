// Erscheinungsbild: Hell, Dunkel oder wie Windows, Akzentfarbe
import { useState } from "react";
import { t } from "../../lib/i18n";
import { PALETTES, setThemePrefs, themePrefs, type Palette, type ThemeMode } from "../../lib/theme";
import { cn } from "../../lib/cn";

const MODES: ThemeMode[] = ["system", "light", "dark"];
const SWATCH: Record<Palette, string> = { sky: "#0066e0", sage: "#1c7a5a", amber: "#a85600" };

export function AppearanceSection() {
  const [prefs, setPrefs] = useState(themePrefs());
  const update = (patch: Partial<typeof prefs>) => setPrefs(setThemePrefs(patch));

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs uppercase tracking-wide text-neutral-500">{t("settings.section.appearance")}</h3>
      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => update({ mode: m })}
            className={cn("btn-outline", prefs.mode === m && "border-accent text-accent")}
          >
            {t(`settings.theme.${m}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {PALETTES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => update({ palette: p })}
            className={cn("flex items-center gap-2 btn-outline", prefs.palette === p && "border-accent")}
          >
            <span className="w-4 h-4 rounded-full" style={{ background: SWATCH[p] }} />
            {t(`settings.palette.${p}`)}
          </button>
        ))}
      </div>
    </section>
  );
}
