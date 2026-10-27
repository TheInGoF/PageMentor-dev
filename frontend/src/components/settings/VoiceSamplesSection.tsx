// Eigene Stimmproben
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";


export function VoiceSamplesSection({ st }: { st: SettingsState }) {
  const { customVoices, deleteVoiceSample, openSampleEdit, playVoicePreview, setVoiceDraft, toggleCustomVisibility, uploadVoiceSample, voiceDraft, voiceUploadBusy } = st;
  return (
    <>
        <section className="flex flex-col gap-3">
          <h3 className="text-xs uppercase tracking-wide text-neutral-500">
            {t("settings.voices.title")}
          </h3>
          <p className="text-xs text-neutral-500">
            {t("settings.voices.subtitle")}
          </p>

          {customVoices.length === 0 ? (
            <p className="text-xs text-neutral-500 italic">
              {t("settings.voices.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {customVoices.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center gap-3 card p-3 bg-bg-elevated"
                >
                  <span className="text-base leading-none">
                    {v.gender === "female" ? "♀" : "♂"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-neutral-100 truncate">
                      {v.label}
                    </div>
                    <div className="text-xs text-neutral-500 font-mono">
                      {v.language} · seed {v.seed} ·{" "}
                      {(v.bytes / 1024).toFixed(0)} KB
                      {v.refTextPresent && ` · ${t("settings.voices.withTranscript")}`}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      toggleCustomVisibility(v.id, !(v.showInAudiobook ?? true))
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
                  <Button variant="ghost" onClick={() => playVoicePreview(v.id)}>
                    {t("settings.voices.preview")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => openSampleEdit(v)}
                    title={t("common.edit")}
                    aria-label={t("common.edit")}
                  >
                    ✏️
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => deleteVoiceSample(v.id, v.label)}
                  >
                    {t("common.delete")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="card p-3 flex flex-col gap-2 bg-bg-elevated">
            <h4 className="text-xs font-semibold text-neutral-300">
              {t("settings.voices.uploadTitle")}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
              <Input
                label={t("settings.voices.label")}
                value={voiceDraft.label}
                onChange={(e) =>
                  setVoiceDraft({ ...voiceDraft, label: e.target.value })
                }
                placeholder={t("settings.voices.labelPlaceholder")}
              />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.voices.gender")}
                </label>
                <select
                  className="input"
                  value={voiceDraft.gender}
                  onChange={(e) =>
                    setVoiceDraft({
                      ...voiceDraft,
                      gender: e.target.value as "female" | "male",
                    })
                  }
                >
                  <option value="female">♀ {t("settings.voices.female")}</option>
                  <option value="male">♂ {t("settings.voices.male")}</option>
                </select>
              </div>
            </div>
            <Input
              label={t("settings.voices.refText")}
              value={voiceDraft.refText}
              onChange={(e) =>
                setVoiceDraft({ ...voiceDraft, refText: e.target.value })
              }
              placeholder={t("settings.voices.refTextPlaceholder")}
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.voices.file")}
              </label>
              <input
                type="file"
                accept="audio/wav,audio/mpeg,audio/mp3,audio/flac,audio/ogg,audio/mp4,audio/x-m4a,.wav,.mp3,.flac,.ogg,.m4a"
                onChange={(e) =>
                  setVoiceDraft({
                    ...voiceDraft,
                    file: e.target.files?.[0] ?? null,
                  })
                }
                className="text-xs text-neutral-400"
              />
              <p className="text-xs text-neutral-500">
                {t("settings.voices.fileHint")}
              </p>
            </div>
            <Button
              onClick={uploadVoiceSample}
              disabled={
                voiceUploadBusy || !voiceDraft.label.trim() || !voiceDraft.file
              }
            >
              {voiceUploadBusy
                ? t("settings.voices.uploading")
                : t("settings.voices.upload")}
            </Button>
          </div>
        </section>

    </>
  );
}
