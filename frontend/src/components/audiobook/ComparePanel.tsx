// Engines vergleichen: gleicher Ausschnitt, je eine Stimme pro Engine, nacheinander
import { useEffect, useMemo, useState } from "react";
import { api, type ChapterAudioStatus, type CompareRun, type Voice } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { compareVoices, isChapterIncluded } from "./helpers";

const baseLabel = (v: Voice) => v.label.replace(/ · Design$/, "");

// Pro Engine: gleiche Stimme wie gewählt, sonst die Standardstimme der Sprache
function pickVoices(voices: Voice[], current: Voice | undefined, lang: string): Voice[] {
  const engines = [...new Set(voices.map((v) => v.engine))];
  return engines
    .map((e) => {
      const own = voices.filter((v) => v.engine === e && v.language === lang).sort(compareVoices);
      if (current?.engine === e) return current;
      return own.find((v) => current && baseLabel(v) === baseLabel(current)) ?? own.find((v) => v.flagship) ?? own[0];
    })
    .filter((v): v is Voice => !!v);
}

export function ComparePanel({
  docId,
  voices,
  voiceId,
  chapters,
  documentLanguage,
}: {
  docId: string;
  voices: Voice[];
  voiceId: string;
  chapters: ChapterAudioStatus[];
  documentLanguage: string;
}) {
  const [run, setRun] = useState<CompareRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const included = useMemo(() => chapters.filter(isChapterIncluded), [chapters]);
  const [chapterId, setChapterId] = useState<string>("");
  const chosen = chapterId || included[0]?.chapter_id || "";
  const picks = useMemo(
    () => pickVoices(voices, voices.find((v) => v.id === voiceId), documentLanguage),
    [voices, voiceId, documentLanguage]
  );
  const running = !!run && !run.finishedAt;

  useEffect(() => {
    api.audio.compareStatus(docId).then((r) => setRun(r.run)).catch(() => {});
  }, [docId]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      api.audio.compareStatus(docId).then((r) => setRun(r.run)).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [docId, running]);

  async function start() {
    setError(null);
    try {
      setRun(await api.audio.compare(docId, chosen, picks.map((v) => v.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (picks.length < 2) return null;

  return (
    <details className="card p-4">
      <summary className="text-sm font-medium cursor-pointer">{t("compare.title")}</summary>
      <div className="flex flex-col gap-3 mt-3">
        <p className="text-xs text-neutral-400">{t("compare.hint")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input max-w-sm" value={chosen} onChange={(e) => setChapterId(e.target.value)}>
            {included.map((c) => (
              <option key={c.chapter_id} value={c.chapter_id}>
                {c.number > 0 ? `${c.number}. ` : ""}
                {c.title}
              </option>
            ))}
          </select>
          <Button onClick={start} disabled={running || !chosen}>
            {running ? t("compare.running") : t("compare.start")}
          </Button>
        </div>
        <p className="text-xs text-neutral-500">{picks.map((v) => `${t(`audiobook.engine.${v.engine}`)}: ${v.label}`).join(" · ")}</p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {run && (
          <div className="flex flex-col gap-2">
            {run.items.map((i) => (
              <div key={i.engine} className="flex flex-wrap items-center gap-3">
                <span className="text-sm w-40">
                  {t(`audiobook.engine.${i.engine}`)} · {i.voiceLabel}
                </span>
                {i.status === "fertig" ? (
                  <audio controls preload="none" src={api.audio.compareFileUrl(docId, i.engine, run.id)} />
                ) : (
                  <span className="text-xs text-neutral-400">{t(`compare.status.${i.status}`)}</span>
                )}
                {i.ms !== undefined && <span className="text-xs text-neutral-500">{(i.ms / 1000).toFixed(1)} s</span>}
                {i.error && <span className="text-xs text-red-400 break-all">{i.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
