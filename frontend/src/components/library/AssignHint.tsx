// Hinweise aus der Pipeline: Qualität prüfen, Modul-Vorschlag ohne Beleg übernehmen
import { api, type Document } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";

function qualityReasons(doc: Document): string[] {
  try {
    return (JSON.parse(doc.quality_json ?? "{}") as { reasons?: string[] }).reasons ?? [];
  } catch {
    return [];
  }
}

export function AssignHint({ doc, onChanged }: { doc: Document; onChanged?: () => void }) {
  const reasons = doc.quality_flag ? qualityReasons(doc) : [];
  const suggest = !doc.module_id && doc.assign_module_id && doc.assign_confidence === "niedrig";
  if (!reasons.length && !suggest) return null;

  async function accept(e: React.MouseEvent) {
    e.stopPropagation();
    await api.study.assign(doc.id, doc.assign_module_id ?? null);
    onChanged?.();
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {reasons.length > 0 && (
        <div className="rounded-md bg-amber-500/10 text-amber-600 px-2 py-1.5" title={reasons.join("\n")}>
          ⚠ {t("library.quality.check")}: {reasons[0]}
          {reasons.length > 1 ? ` (+${reasons.length - 1})` : ""}
        </div>
      )}
      {suggest && (
        <div className="rounded-md bg-accent/10 px-2 py-1.5 flex items-center gap-2">
          <span className="flex-1 min-w-0 truncate" title={`${t("library.assign.why")} · ${doc.assign_rule ?? ""}`}>
            {t("library.assign.suggest", { module: doc.assign_code ?? doc.assign_name ?? "?" })}
          </span>
          <Button variant="outline" className="!px-2 !py-0.5 text-xs" onClick={accept}>
            {t("library.assign.accept")}
          </Button>
        </div>
      )}
    </div>
  );
}
