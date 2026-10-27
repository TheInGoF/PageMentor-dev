// Stimm-Designs
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";


export function VoiceDesignsSection({ st }: { st: SettingsState }) {
  const { deleteDesign, designBusy, designDraft, designPreviewSeed, designPreviewUrl, openDesignEdit, playDesignPreview, previewDesign, regenerateDesignReference, saveDesign, setDesignDraft, toggleDesignVisibility, voiceDesigns } = st;
  return (
    <>
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.design.title")}
          </h3>
          <p className="text-xs text-neutral-500">
            {t("settings.design.subtitle")}
          </p>

          {voiceDesigns.length === 0 ? (
            <p className="text-xs text-neutral-500 italic">
              {t("settings.design.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {voiceDesigns.map((v) => (
                <li
                  key={v.id}
                  className="card p-3 bg-bg-elevated flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 sm:flex-1">
                    <span className="text-base leading-none">
                      {v.gender === "female" ? "♀" : "♂"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-neutral-100 truncate">
                        {v.label}
                      </div>
                      <div className="text-xs text-neutral-500 truncate">
                        {v.description}
                      </div>
                      <div className="text-xs text-neutral-600 font-mono">
                        {v.language} · seed {v.seed}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-1 sm:flex-none">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        toggleDesignVisibility(v.id, !(v.showInAudiobook ?? true))
                      }
                      title={t(
                        v.showInAudiobook === false
                          ? "settings.voices.unhide"
                          : "settings.voices.hide"
                      )}
                      aria-label={t(
                        v.showInAudiobook === false
                          ? "settings.voices.unhide"
                          : "settings.voices.hide"
                      )}
                    >
                      {v.showInAudiobook === false ? "🙈" : "👁"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => playDesignPreview(v.id)}
                      title={t("settings.voices.preview")}
                      aria-label={t("settings.voices.preview")}
                    >
                      ▶
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => regenerateDesignReference(v.id, v.label)}
                      disabled={designBusy}
                      title={t("settings.design.regenRefTooltip")}
                      aria-label={t("settings.design.regenRef")}
                    >
                      ↻
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => openDesignEdit(v)}
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                    >
                      ✏️
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => deleteDesign(v.id, v.label)}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      ×
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="card p-3 flex flex-col gap-2 bg-bg-elevated">
            <h4 className="text-xs font-semibold text-neutral-300">
              {t("settings.design.createTitle")}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
              <Input
                label={t("settings.design.label")}
                value={designDraft.label}
                onChange={(e) =>
                  setDesignDraft({ ...designDraft, label: e.target.value })
                }
                placeholder={t("settings.design.labelPlaceholder")}
              />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.design.gender")}
                </label>
                <select
                  className="input"
                  value={designDraft.gender}
                  onChange={(e) =>
                    setDesignDraft({
                      ...designDraft,
                      gender: e.target.value as "female" | "male",
                    })
                  }
                >
                  <option value="female">♀ {t("settings.voices.female")}</option>
                  <option value="male">♂ {t("settings.voices.male")}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.design.language")}
                </label>
                <select
                  className="input"
                  value={designDraft.language}
                  onChange={(e) =>
                    setDesignDraft({
                      ...designDraft,
                      language: e.target.value as "de" | "en",
                    })
                  }
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.design.description")}
              </label>
              <textarea
                className="input min-h-[80px] resize-y"
                value={designDraft.description}
                onChange={(e) =>
                  setDesignDraft({ ...designDraft, description: e.target.value })
                }
                placeholder={t("settings.design.descriptionPlaceholder")}
              />
              <p className="text-xs text-neutral-500">
                {t("settings.design.descriptionHint")}
              </p>
            </div>
            <Input
              label={t("settings.design.seed")}
              type="number"
              step="1"
              value={designDraft.seed}
              onChange={(e) =>
                setDesignDraft({ ...designDraft, seed: e.target.value })
              }
              placeholder={t("settings.design.seedPlaceholder")}
            />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => previewDesign("fresh")}
                disabled={
                  designBusy || designDraft.description.trim().length < 10
                }
              >
                {designBusy
                  ? t("settings.design.previewBusy")
                  : designPreviewSeed === null
                  ? t("settings.design.previewFirst.button")
                  : t("settings.design.reroll")}
              </Button>
              {designDraft.seed.trim() && (
                <Button
                  variant="ghost"
                  onClick={() => previewDesign("useInputSeed")}
                  disabled={designBusy}
                >
                  {t("settings.design.previewInputSeed")}
                </Button>
              )}
              {designPreviewSeed !== null && (
                <span className="text-xs text-neutral-500 font-mono">
                  {t("settings.design.currentSeed", {
                    seed: String(designPreviewSeed),
                  })}
                </span>
              )}
            </div>

            {designPreviewUrl && (
              <audio
                controls
                src={designPreviewUrl}
                className="w-full mt-1"
                autoPlay
              />
            )}

            <Button
              onClick={saveDesign}
              disabled={
                designBusy ||
                !designDraft.label.trim() ||
                designDraft.description.trim().length < 10 ||
                designPreviewSeed === null
              }
            >
              {designBusy
                ? t("settings.design.creating")
                : t("settings.design.saveThisVoice")}
            </Button>
          </div>
        </section>

    </>
  );
}
