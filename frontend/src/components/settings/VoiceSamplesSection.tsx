// Eigene Stimmen: Aufnahmen und Beschreibungen in einer Liste; jede gilt für alle Engines, die sie klonen können
import { useState } from "react";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";
import { Card, Notice } from "./parts";
import { Menu, type MenuItem } from "../ui/Menu";
import type { Voice } from "../../lib/api";
import { VoiceExtractor, isVideoFile } from "./VoiceExtractor";

type Form = null | "sample" | "design";

// Eine Probe, mehrere Engines: je Engine ein Knopf zum Anhören, damit man vergleichen kann, welche am besten klingt.
// Weitere Aktionen hinter ⋯ (Styleguide)
function VoiceRow(props: {
  gender: string;
  label: string;
  meta: string;
  hidden: boolean;
  engines: Voice[];
  onPlayEngine: (voiceId: string) => void;
  menu: MenuItem[];
}) {
  return (
    <li className="flex items-center gap-2 py-2">
      <span className="w-6 text-center" aria-hidden>
        {props.gender === "female" ? "♀" : "♂"}
      </span>
      <div className={"flex-1 min-w-0 " + (props.hidden ? "opacity-50" : "")}>
        <div className="text-sm truncate">{props.label}</div>
        <div className="text-xs text-neutral-500 truncate">{props.meta}</div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {props.engines.map((v) => (
          <button key={v.id} type="button" className="chip" title={t("voices.own.playWith", { engine: t(`audiobook.engine.${v.engine}`) })} onClick={() => props.onPlayEngine(v.id)}>
            ▶ {t(`audiobook.engine.${v.engine}`)}
          </button>
        ))}
      </div>
      <Menu label={t("voices.own.actions")} items={props.menu} />
    </li>
  );
}

// Engine-Stimmen einer Probe oder eines Designs: IDs enden auf "custom:<id>" bzw. "design:<id>"
function enginesFor(voices: Voice[], kind: "custom" | "design", id: string): Voice[] {
  const seen = new Set<string>();
  return voices.filter((v) => v.id.endsWith(`${kind}:${id}`) && !seen.has(v.engine) && !!seen.add(v.engine));
}

export function VoiceSamplesSection({ st, qwenOn, cloneOn, onEngines }: { st: SettingsState; qwenOn: boolean; cloneOn: boolean; onEngines: () => void }) {
  const {
    customVoices, deleteVoiceSample, engineVoices, openSampleEdit, playEngineVoice, playVoicePreview, setVoiceDraft, toggleCustomVisibility, uploadVoiceSample, voiceDraft, voiceUploadBusy,
    deleteDesign, designBusy, designDraft, designPreviewSeed, designPreviewUrl, openDesignEdit, playDesignPreview, previewDesign, regenerateDesignReference, saveDesign, setDesignDraft, toggleDesignVisibility, voiceDesigns,
  } = st;
  const [form, setForm] = useState<Form>(null);
  // Stimm-Extraktor: gewähltes Video und Länge des übernommenen Ausschnitts
  const [extractFrom, setExtractFrom] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<number | null>(null);
  const count = customVoices.length + voiceDesigns.length;
  const toggleForm = (f: Form) => setForm((cur) => (cur === f ? null : f));

  return (
    <Card title={t("voices.own.title")} status={count ? t("voices.own.count", { n: count }) : undefined}>
      {!cloneOn && (
        <Notice action={<Button variant="outline" onClick={onEngines}>{t("voices.own.toEngines")}</Button>}>{t("voices.own.needsEngine")}</Notice>
      )}

      {count === 0 ? (
        <p className="text-sm text-neutral-500">{t("voices.own.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {customVoices.map((v) => (
            <VoiceRow
              key={v.id}
              gender={v.gender}
              label={v.label}
              meta={[t("voices.own.kindSample"), v.language, v.refTextPresent ? t("settings.voices.withTranscript") : t("voices.own.noTranscript")].join(" · ")}
              hidden={v.showInAudiobook === false}
              engines={enginesFor(engineVoices, "custom", v.id)}
              onPlayEngine={playEngineVoice}
              menu={[
                { label: t("voices.own.playRecording"), onClick: () => playVoicePreview(v.id) },
                { label: t(v.showInAudiobook === false ? "settings.voices.unhide" : "settings.voices.hide"), onClick: () => toggleCustomVisibility(v.id, !(v.showInAudiobook ?? true)) },
                { label: t("common.edit"), onClick: () => openSampleEdit(v) },
                { label: t("common.delete"), onClick: () => deleteVoiceSample(v.id, v.label), danger: true },
              ]}
            />
          ))}
          {voiceDesigns.map((v) => (
            <VoiceRow
              key={v.id}
              gender={v.gender}
              label={v.label}
              meta={[t("voices.own.kindDesign"), v.language, v.description].join(" · ")}
              hidden={v.showInAudiobook === false}
              engines={enginesFor(engineVoices, "design", v.id)}
              onPlayEngine={playEngineVoice}
              menu={[
                { label: t("voices.own.playDesign"), onClick: () => playDesignPreview(v.id) },
                { label: t("settings.design.regenRef"), onClick: () => regenerateDesignReference(v.id, v.label), disabled: designBusy || !qwenOn },
                { label: t(v.showInAudiobook === false ? "settings.voices.unhide" : "settings.voices.hide"), onClick: () => toggleDesignVisibility(v.id, !(v.showInAudiobook ?? true)) },
                { label: t("common.edit"), onClick: () => openDesignEdit(v) },
                { label: t("common.delete"), onClick: () => deleteDesign(v.id, v.label), danger: true },
              ]}
            />
          ))}
        </ul>
      )}

      {cloneOn && (
        <div className="flex flex-wrap gap-2">
          <Button variant={form === "sample" ? "primary" : "outline"} onClick={() => toggleForm("sample")}>
            + {t("voices.own.addSample")}
          </Button>
          {qwenOn && (
            <Button variant={form === "design" ? "primary" : "outline"} onClick={() => toggleForm("design")}>
              + {t("voices.own.addDesign")}
            </Button>
          )}
        </div>
      )}

      {form === "sample" && cloneOn && (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
            <Input label={t("settings.voices.label")} value={voiceDraft.label} onChange={(e) => setVoiceDraft({ ...voiceDraft, label: e.target.value })} placeholder={t("settings.voices.labelPlaceholder")} />
            <GenderSelect value={voiceDraft.gender} onChange={(g) => setVoiceDraft({ ...voiceDraft, gender: g })} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-neutral-400">{t("settings.design.language")}</label>
            <select className="input" value={voiceDraft.language} onChange={(e) => setVoiceDraft({ ...voiceDraft, language: e.target.value as "de" | "en" | "es" })}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </div>
          <Input label={t("voices.own.transcript")} value={voiceDraft.refText} onChange={(e) => setVoiceDraft({ ...voiceDraft, refText: e.target.value })} placeholder={t("settings.voices.refTextPlaceholder")} />
          <div className="flex flex-col gap-2">
            <label className="text-xs text-neutral-400">{t("voices.own.file")}</label>
            <input
              type="file"
              accept="audio/*,video/*,.wav,.mp3,.flac,.ogg,.m4a,.mp4,.mkv,.mov,.webm,.avi"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                // Video: erst den Ausschnitt mit der Stimme wählen
                if (f && isVideoFile(f)) {
                  setExtractFrom(f);
                  setExtracted(null);
                  setVoiceDraft({ ...voiceDraft, file: null });
                } else {
                  setExtractFrom(null);
                  setVoiceDraft({ ...voiceDraft, file: f });
                }
              }}
              className="text-sm text-neutral-400"
            />
            <p className="text-xs text-neutral-500">{t("voices.own.fileHint")} {t("voiceExtract.fileHint")}</p>
          </div>
          {extractFrom && (
            <VoiceExtractor
              key={extractFrom.name + extractFrom.size}
              file={extractFrom}
              onExtract={(wav, seconds) => {
                setVoiceDraft({ ...voiceDraft, file: wav });
                setExtracted(seconds);
              }}
              onClose={() => setExtractFrom(null)}
            />
          )}
          {extracted !== null && voiceDraft.file && <Notice>{t("voiceExtract.applied", { s: extracted.toFixed(2), name: voiceDraft.file.name })}</Notice>}
          <div>
            <Button onClick={uploadVoiceSample} disabled={voiceUploadBusy || !voiceDraft.label.trim() || !voiceDraft.file}>
              {voiceUploadBusy ? t("settings.voices.uploading") : t("settings.voices.upload")}
            </Button>
          </div>
        </div>
      )}

      {form === "design" && qwenOn && (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-4">
            <Input label={t("settings.design.label")} value={designDraft.label} onChange={(e) => setDesignDraft({ ...designDraft, label: e.target.value })} placeholder={t("settings.design.labelPlaceholder")} />
            <GenderSelect value={designDraft.gender} onChange={(g) => setDesignDraft({ ...designDraft, gender: g })} />
            <div className="flex flex-col gap-2">
              <label className="text-xs text-neutral-400">{t("settings.design.language")}</label>
              <select className="input" value={designDraft.language} onChange={(e) => setDesignDraft({ ...designDraft, language: e.target.value as "de" | "en" | "es" })}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-neutral-400">{t("settings.design.description")}</label>
            <textarea
              className="input min-h-[80px] resize-y"
              value={designDraft.description}
              onChange={(e) => setDesignDraft({ ...designDraft, description: e.target.value })}
              placeholder={t("settings.design.descriptionPlaceholder")}
            />
            <p className="text-xs text-neutral-500">{t("voices.own.descriptionHint")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => previewDesign("fresh")} disabled={designBusy || designDraft.description.trim().length < 10}>
              {designBusy ? t("settings.design.previewBusy") : designPreviewSeed === null ? t("settings.design.previewFirst.button") : t("settings.design.reroll")}
            </Button>
            <Button onClick={saveDesign} disabled={designBusy || !designDraft.label.trim() || designDraft.description.trim().length < 10 || designPreviewSeed === null}>
              {designBusy ? t("settings.design.creating") : t("settings.design.saveThisVoice")}
            </Button>
          </div>
          {designPreviewUrl && <audio controls src={designPreviewUrl} className="w-full" autoPlay />}
          <details className="text-sm">
            <summary className="text-xs text-neutral-500 cursor-pointer select-none">{t("settings.design.seed")}</summary>
            <div className="flex items-end gap-2 pt-2">
              <div className="flex-1">
                <Input type="number" step="1" value={designDraft.seed} onChange={(e) => setDesignDraft({ ...designDraft, seed: e.target.value })} placeholder={t("settings.design.seedPlaceholder")} />
              </div>
              {designDraft.seed.trim() && (
                <Button variant="ghost" onClick={() => previewDesign("useInputSeed")} disabled={designBusy}>
                  {t("settings.design.previewInputSeed")}
                </Button>
              )}
            </div>
            {designPreviewSeed !== null && <p className="text-xs text-neutral-500 pt-2">{t("settings.design.currentSeed", { seed: String(designPreviewSeed) })}</p>}
          </details>
        </div>
      )}
    </Card>
  );
}

function GenderSelect({ value, onChange }: { value: "female" | "male"; onChange: (g: "female" | "male") => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-neutral-400">{t("settings.voices.gender")}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as "female" | "male")}>
        <option value="female">♀ {t("settings.voices.female")}</option>
        <option value="male">♂ {t("settings.voices.male")}</option>
      </select>
    </div>
  );
}
