// Mehrere Dokumente einem Modul zuordnen
import { useState } from "react";
import { api, type ModuleListItem } from "../../lib/api";
import { groupBySemester } from "../../lib/modules";
import { t } from "../../lib/i18n";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

export function AssignModuleDialog({ docIds, modules, onClose }: { docIds: string[]; modules: ModuleListItem[]; onClose: (changed: boolean) => void }) {
  const [moduleId, setModuleId] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save() {
    setBusy(true);
    try {
      for (const id of docIds) await api.study.assign(id, moduleId || null);
      onClose(true);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => onClose(false)}
      title={t("library.assign.title", { n: docIds.length })}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            {t("common.close")}
          </Button>
          <Button onClick={save} disabled={busy}>
            {t("library.assign.save")}
          </Button>
        </>
      }
    >
      <select className="input w-full" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
        <option value="">{t("library.filter.module.unassigned")}</option>
        {groupBySemester(modules).map((g) => (
          <optgroup key={g.semester ?? "none"} label={g.semester != null ? t("modules.semester", { n: g.semester }) : t("modules.noSemester")}>
            {g.modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code ? `${m.code} · ` : ""}
                {m.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Modal>
  );
}
