// Intro-Text bearbeiten und vertonen
import { useEffect, useMemo, useState } from "react";
import type { Voice } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";


// Standard-Intro als lesbarer Text, Namen in normaler Schreibweise
// Die phonetische Umschrift macht Gemma direkt vor der Synthese
function buildIntroDefault(
  meta: { title: string; author: string | null; language: string } | null,
  voice: Voice | null,
  model: string
): string {
  if (!meta) return "";
  const isDe = meta.language === "de";
  const lines: string[] = [];

  // Zusätze wie "(Design)" oder " · Design" aus dem Stimmnamen entfernen
  const spokenVoiceLabel = voice
    ? voice.label
        .replace(/\s*[·•]\s*\S.*$/, "")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .trim()
    : "";

  if (isDe) {
    lines.push(`Hörbuch: ${meta.title}.`);
    lines.push("");
    if (meta.author) {
      lines.push(`Von ${meta.author}.`);
    }
    if (model) {
      lines.push(`Aufbereitet durch ${model}.`);
    }
    if (voice) {
      lines.push(
        `Gesprochen durch Qwen3-TTS, mit der Stimme ${spokenVoiceLabel}.`
      );
    }
    lines.push(`Erstellt mit PageMentor.`);
  } else {
    lines.push(`Audiobook: ${meta.title}.`);
    lines.push("");
    if (meta.author) {
      lines.push(`By ${meta.author}.`);
    }
    if (model) {
      lines.push(`Prepared with ${model}.`);
    }
    if (voice) {
      lines.push(
        `Narrated by Qwen3-TTS, with the voice ${spokenVoiceLabel}.`
      );
    }
    lines.push(`Created with PageMentor.`);
  }
  return lines.join("\n");
}

export function IntroEditor({
  intro,
  voice,
  modelName,
  busy,
  canGenerate,
  onSave,
  onGenerate,
  onDeleteAudio,
  onPreprocess,
  onEditTts,
}: {
  intro: {
    text: string | null;
    audioUrl: string | null;
    docMeta: {
      title: string;
      author: string | null;
      language: string;
    } | null;
  };
  voice: Voice | null;
  modelName: string;
  busy: boolean;
  canGenerate: boolean;
  onSave: (text: string | null) => void;
  onGenerate: () => void;
  onDeleteAudio: () => void;
  onPreprocess: (force: boolean) => void;
  onEditTts: () => void;
}) {
  const [draft, setDraft] = useState<string>("");
  const [open, setOpen] = useState<boolean>(false);

  // Entwurf bei Änderung von außen nachziehen
  useEffect(() => {
    setDraft(intro.text ?? "");
  }, [intro.text]);

  const defaultText = useMemo(
    () => buildIntroDefault(intro.docMeta, voice, modelName),
    [intro.docMeta, voice, modelName]
  );

  const dirty = (intro.text ?? "") !== draft;
  const hasIntro = !!(intro.text && intro.text.trim().length > 0);

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            {t("audiobook.intro.title")}
            {hasIntro && (
              <span className="tag-accent text-[10px]">
                {t("audiobook.intro.active")}
              </span>
            )}
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t("audiobook.intro.hint")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-accent hover:underline"
        >
          {open ? t("audiobook.intro.collapse") : t("audiobook.intro.expand")}
        </button>
      </div>

      {open && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full bg-bg-elevated border border-border rounded-lg p-3 min-h-[140px] font-mono text-[12px] leading-relaxed text-neutral-100 resize-y focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
            placeholder={defaultText || t("audiobook.intro.placeholder")}
            spellCheck
          />
          <div className="flex items-center gap-2 flex-wrap">
            {defaultText && draft !== defaultText && (
              <Button
                variant="ghost"
                onClick={() => setDraft(defaultText)}
                disabled={busy}
              >
                {t("audiobook.intro.useDefault")}
              </Button>
            )}
            <div className="flex-1" />
            {hasIntro && !dirty && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => onPreprocess(false)}
                  disabled={busy}
                >
                  {busy
                    ? t("audiobook.intro.preprocessBusy")
                    : t("audiobook.intro.preprocess")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={onEditTts}
                  disabled={busy}
                >
                  {t("audiobook.intro.viewEdit")}
                </Button>
              </>
            )}
            {hasIntro && intro.audioUrl && (
              <Button variant="outline" onClick={onDeleteAudio} disabled={busy}>
                {t("audiobook.intro.deleteAudio")}
              </Button>
            )}
            {hasIntro && !intro.audioUrl && (
              <Button
                variant="outline"
                onClick={onGenerate}
                disabled={busy || !canGenerate}
                title={!canGenerate ? t("audiobook.voice.empty") : undefined}
              >
                {t("audiobook.intro.generateAudio")}
              </Button>
            )}
            <Button
              onClick={() => onSave(draft.trim() ? draft : null)}
              disabled={busy || !dirty}
            >
              {busy ? t("common.saving") : t("audiobook.intro.save")}
            </Button>
          </div>
          {intro.audioUrl && (
            <audio
              controls
              preload="none"
              src={intro.audioUrl}
              className="w-full accent-accent [color-scheme:dark]"
            />
          )}
        </>
      )}
    </section>
  );
}
