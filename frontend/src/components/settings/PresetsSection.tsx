// Preset-Stimmen ein- und ausblenden
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";


export function PresetsSection({ st }: { st: SettingsState }) {
  const { presetVisibility, togglePresetVisibility } = st;
  return (
    <>
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.presets.title")}
          </h3>
          <p className="text-xs text-neutral-500">
            {t("settings.presets.subtitle")}
          </p>

          {presetVisibility.length === 0 ? (
            <p className="text-xs text-neutral-500 italic">
              {t("settings.presets.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {presetVisibility.map((p) => (
                <li
                  key={p.voice.id}
                  className="flex items-center gap-3 card p-3 bg-bg-elevated"
                >
                  <span className="text-base leading-none">
                    {p.voice.gender === "female" ? "♀" : "♂"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-neutral-100 truncate">
                      {p.voice.label}
                    </div>
                    <div className="text-xs text-neutral-500 font-mono truncate">
                      {p.voice.language}
                      {p.voice.engine ? ` · ${p.voice.engine}` : ""}
                      {" · "}
                      {p.voice.id}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      togglePresetVisibility(p.voice.id, !p.visible)
                    }
                    title={t(
                      p.visible
                        ? "settings.voices.hide"
                        : "settings.voices.unhide"
                    )}
                    aria-label={t(
                      p.visible
                        ? "settings.voices.hide"
                        : "settings.voices.unhide"
                    )}
                  >
                    {p.visible ? "👁" : "🙈"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

    </>
  );
}
