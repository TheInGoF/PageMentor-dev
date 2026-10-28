// Eigene Stimmen: Aufnahmen (klonen Qwen, F5, TADA) und Beschreibungen (nur Qwen) in einer Liste
import { useState, type ReactNode } from "react";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";
import { Card, Notice } from "./parts";

type Form = null | "sample" | "design";

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: string }) {
  return (
    <Button variant="ghost" className="!px-2 w-10 flex-none" onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      {children}
    </Button>
  );
}

function VoiceRow(props: {
  gender: string;
  label: string;
  meta: string;
  hidden: boolean;
  onPlay: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  extra?: ReactNode;
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
      <IconButton label={t("settings.voices.preview")} onClick={props.onPlay}>
        ▶
      </IconButton>
      <IconButton label={t(props.hidden ? "settings.voices.unhide" : "settings.voices.hide")} onClick={props.onToggle}>
        {props.hidden ? "🙈" : "👁"}
      </IconButton>
      {/* Platz für ↻ auch ohne, damit die Knöpfe untereinander stehen */}
      {props.extra ?? <span className="w-10 flex-none" aria-hidden />}
      <IconButton label={t("common.edit")} onClick={props.onEdit}>
        ✏️
      </IconButton>
      <IconButton label={t("common.delete")} onClick={props.onDelete}>
        🗑
      </IconButton>
    </li>
  );
}

export function VoiceSamplesSection({ st, qwenOn, cloneOn, onEngines }: { st: SettingsState; qwenOn: boolean; cloneOn: boolean; onEngines: () => void }) {
  const {
    customVoices, deleteVoiceSample, openSampleEdit, playVoicePreview, setVoiceDraft, toggleCustomVisibility, uploadVoiceSample, voiceDraft, voiceUploadBusy,
    deleteDesign, designBusy, designDraft, designPreviewSeed, designPreviewUrl, openDesignEdit, playDesignPreview, previewDesign, regenerateDesignReference, saveDesign, setDesignDraft, toggleDesignVisibility, voiceDesigns,
  } = st;
  const [form, setForm] = useState<Form>(null);
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
              onPlay={() => playVoicePreview(v.id)}
              onToggle={() => toggleCustomVisibility(v.id, !(v.showInAudiobook ?? true))}
              onEdit={() => openSampleEdit(v)}
              onDelete={() => deleteVoiceSample(v.id, v.label)}
            />
          ))}
          {voiceDesigns.map((v) => (
            <VoiceRow
              key={v.id}
              gender={v.gender}
              label={v.label}
              meta={[t("voices.own.kindDesign"), v.language, v.description].join(" · ")}
              hidden={v.showInAudiobook === false}
              onPlay={() => playDesignPreview(v.id)}
              onToggle={() => toggleDesignVisibility(v.id, !(v.showInAudiobook ?? true))}
              onEdit={() => openDesignEdit(v)}
              onDelete={() => deleteDesign(v.id, v.label)}
              extra={
                <IconButton label={t("settings.design.regenRef")} onClick={() => regenerateDesignReference(v.id, v.label)} disabled={designBusy || !qwenOn}>
                  ↻
                </IconButton>
              }
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
          <Input label={t("voices.own.transcript")} value={voiceDraft.refText} onChange={(e) => setVoiceDraft({ ...voiceDraft, refText: e.target.value })} placeholder={t("settings.voices.refTextPlaceholder")} />
          <div className="flex flex-col gap-2">
            <label className="text-xs text-neutral-400">{t("voices.own.file")}</label>
            <input
              type="file"
              accept="audio/wav,audio/mpeg,audio/mp3,audio/flac,audio/ogg,audio/mp4,audio/x-m4a,.wav,.mp3,.flac,.ogg,.m4a"
              onChange={(e) => setVoiceDraft({ ...voiceDraft, file: e.target.files?.[0] ?? null })}
              className="text-sm text-neutral-400"
            />
            <p className="text-xs text-neutral-500">{t("voices.own.fileHint")}</p>
          </div>
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
              <select className="input" value={designDraft.language} onChange={(e) => setDesignDraft({ ...designDraft, language: e.target.value as "de" | "en" })}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
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
