// Auswahl-Chip für eine Stimme
import type { Voice } from "../../lib/api";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";

export function VoiceChip({
  voice,
  active,
  onSelect,
}: {
  voice: Voice;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-1 px-3 py-2 rounded-lg border text-left transition-colors",
        active
          ? "border-accent bg-accent/10"
          : "border-border hover:border-border-strong hover:bg-bg-hover"
      )}
      title={voice.note ?? undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-neutral-100">{voice.label}</span>
        {voice.flagship && (
          <span className="tag-accent text-[10px]">{t("audiobook.voice.top")}</span>
        )}
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300">
          {t("audiobook.engine.qwen")}
        </span>
      </div>
      <span className="text-[11px] text-neutral-500">
        {voice.gender === "female" ? "♀" : "♂"} · {voice.locale}
      </span>
    </button>
  );
}
