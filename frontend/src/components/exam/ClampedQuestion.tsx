// Lange Frage gekürzt, aufklappbar
import { useState } from "react";
import { cn } from "../../lib/cn";
import { t } from "../../lib/i18n";

export function ClampedQuestion({ text }: { text: string }) {
  const LIMIT = 600; // Zeichen — entspricht grob 3–4 Zeilen bei typ. Fragestellungen.
  const [expanded, setExpanded] = useState(false);
  const needsClamp = text.length > LIMIT;
  const shown = !needsClamp || expanded ? text : text.slice(0, LIMIT).trimEnd() + "…";

  return (
    <div className="flex flex-col gap-2">
      <p
        className={cn(
          "text-lg md:text-xl leading-relaxed whitespace-pre-wrap",
          needsClamp && !expanded ? "max-h-[40vh] overflow-y-auto" : ""
        )}
      >
        {shown}
      </p>
      {needsClamp && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-xs text-accent hover:underline"
        >
          {expanded ? t("exam.question.collapse") : t("exam.question.expand")}
        </button>
      )}
    </div>
  );
}
