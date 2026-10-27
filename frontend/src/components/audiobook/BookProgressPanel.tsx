// Fortschritt des Buch-Laufs mit Laufzeit und Restzeit
import { t } from "../../lib/i18n";
import { formatDuration } from "./helpers";

export function BookProgressPanel({
  progress,
  benchmarkMsPerChar,
}: {
  progress: {
    totalChapters: number;
    currentChapter: number;
    chunkCurrent: number;
    chunkTotal: number;
    startedAt: number;
    chapterChars: number[];
  };
  // Gemessener ms/Zeichen-Wert der Stimme, Startwert für die Restzeit
  benchmarkMsPerChar: number | null;
}) {
  const {
    totalChapters,
    currentChapter,
    chunkCurrent,
    chunkTotal,
    startedAt,
    chapterChars,
  } = progress;
  // startedAt 0 nach Reconnect: Laufzeit nicht anzeigen
  const elapsedMs = startedAt > 0 ? Date.now() - startedAt : null;

  // Zeichen gesamt und erledigt
  const totalChars = chapterChars.reduce((a, b) => a + b, 0);

  // Fertige Kapitel zählen voll
  const completedIdx = Math.max(0, currentChapter - 1);
  const completedChars = chapterChars
    .slice(0, completedIdx)
    .reduce((a, b) => a + b, 0);

  // Aktuelles Kapitel anteilig über Chunks
  const currentChapterTotal =
    currentChapter >= 1 && currentChapter <= chapterChars.length
      ? chapterChars[currentChapter - 1]
      : 0;
  const chapterFrac = chunkTotal > 0 ? chunkCurrent / chunkTotal : 0;
  const charsDone = completedChars + currentChapterTotal * chapterFrac;
  const charsRemaining = Math.max(0, totalChars - charsDone);

  // Ab 800 Zeichen eigene Messung, sonst Backend-Wert
  const liveRate =
    elapsedMs !== null && charsDone >= 800 ? elapsedMs / charsDone : null;
  const rate = liveRate ?? benchmarkMsPerChar;

  const etaMs =
    rate !== null ? Math.max(0, Math.round(charsRemaining * rate)) : null;

  // Anzeige in Zeichen pro Minute
  const charsPerMin =
    rate !== null && rate > 0 ? Math.round(60_000 / rate) : null;

  return (
    <div className="card p-4 bg-bg-elevated flex flex-col gap-2 border-accent-subtle">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-accent">
            {t("audiobook.progress.chapter", {
              current: currentChapter,
              total: totalChapters,
            })}
          </span>
          {chunkTotal > 0 && (
            <span className="text-xs text-neutral-500">
              · {t("audiobook.progress.chunk", {
                current: chunkCurrent,
                total: chunkTotal,
              })}
            </span>
          )}
          {totalChars > 0 && (
            <span className="text-xs text-neutral-500 font-mono">
              · {Math.round(charsDone).toLocaleString()}/
              {totalChars.toLocaleString()} chars
            </span>
          )}
        </div>
        <div className="text-xs text-neutral-500 font-mono flex items-baseline gap-3">
          {elapsedMs !== null && (
            <span>
              {t("audiobook.progress.elapsed", {
                time: formatDuration(elapsedMs),
              })}
            </span>
          )}
          {charsPerMin !== null && (
            <span>
              {t("audiobook.progress.rate", { n: charsPerMin })}
            </span>
          )}
          {etaMs !== null && (
            <span>
              {t("audiobook.progress.eta", { time: formatDuration(etaMs) })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
