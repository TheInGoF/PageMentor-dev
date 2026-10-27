// Hinweis oben in der App, solange die Engine eingerichtet wird oder Hilfe braucht
import { t } from "../../lib/i18n";
import { useEngineStatus } from "./useEngineStatus";

export function EngineBanner({ onOpen }: { onOpen: () => void }) {
  const { status } = useEngineStatus();
  if (!status?.windows) return null;
  const task = status.task;
  if (!task && status.autoStart !== "braucht-hilfe") return null;
  const pct = task?.fraction !== undefined ? ` ${Math.round(task.fraction * 100)} %` : "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        "w-full text-left px-4 py-2 text-xs border-b " +
        (task ? "bg-sky-500/10 text-sky-200 border-sky-500/30" : "bg-red-500/10 text-red-200 border-red-500/30")
      }
    >
      {task ? t("engine.banner.running", { title: task.title, pct, message: task.message }) : t("engine.banner.help")}
    </button>
  );
}
