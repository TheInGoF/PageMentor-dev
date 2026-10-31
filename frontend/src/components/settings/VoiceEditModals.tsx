// Bearbeiten-Dialoge für Stimmproben und Designs
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";


export function VoiceEditModals({ st }: { st: SettingsState }) {
  const { editBusy, editDesign, editSample, saveDesignEdit, saveSampleEdit, setEditDesign, setEditSample } = st;
  return (
    <>
      <Modal
        open={!!editSample}
        onClose={() => !editBusy && setEditSample(null)}
        title={t("settings.voices.editTitle")}
        size="xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditSample(null)}
              disabled={editBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={saveSampleEdit} disabled={editBusy}>
              {editBusy ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        }
      >
        {editSample && (
          <div className="flex flex-col gap-3">
            <Input
              label={t("settings.voices.label")}
              value={editSample.label}
              onChange={(e) =>
                setEditSample({ ...editSample, label: e.target.value })
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.voices.gender")}
                </label>
                <select
                  className="input"
                  value={editSample.gender}
                  onChange={(e) =>
                    setEditSample({
                      ...editSample,
                      gender: e.target.value as "female" | "male",
                    })
                  }
                >
                  <option value="female">♀ {t("settings.voices.female")}</option>
                  <option value="male">♂ {t("settings.voices.male")}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.design.language")}
                </label>
                <select
                  className="input"
                  value={editSample.language}
                  onChange={(e) =>
                    setEditSample({ ...editSample, language: e.target.value })
                  }
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.voices.refText")}
              </label>
              <textarea
                className="input min-h-[60px] resize-y"
                value={editSample.refText}
                onChange={(e) =>
                  setEditSample({ ...editSample, refText: e.target.value })
                }
                placeholder={t("settings.voices.refTextPlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.voices.instruct")}
              </label>
              <textarea
                className="input min-h-[80px] resize-y"
                value={editSample.instruct}
                onChange={(e) =>
                  setEditSample({ ...editSample, instruct: e.target.value })
                }
                placeholder={t("settings.voices.instructPlaceholder")}
              />
              <p className="text-xs text-neutral-500">
                {t("settings.voices.instructHint")}
              </p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editDesign}
        onClose={() => !editBusy && setEditDesign(null)}
        title={t("settings.design.editTitle")}
        size="xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditDesign(null)}
              disabled={editBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={saveDesignEdit} disabled={editBusy}>
              {editBusy ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        }
      >
        {editDesign && (
          <div className="flex flex-col gap-3">
            <Input
              label={t("settings.design.label")}
              value={editDesign.label}
              onChange={(e) =>
                setEditDesign({ ...editDesign, label: e.target.value })
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.design.gender")}
                </label>
                <select
                  className="input"
                  value={editDesign.gender}
                  onChange={(e) =>
                    setEditDesign({
                      ...editDesign,
                      gender: e.target.value as "female" | "male",
                    })
                  }
                >
                  <option value="female">♀ {t("settings.voices.female")}</option>
                  <option value="male">♂ {t("settings.voices.male")}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-400">
                  {t("settings.design.language")}
                </label>
                <select
                  className="input"
                  value={editDesign.language}
                  onChange={(e) =>
                    setEditDesign({ ...editDesign, language: e.target.value })
                  }
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-400">
                {t("settings.design.description")}
              </label>
              <textarea
                className="input min-h-[120px] resize-y"
                value={editDesign.description}
                onChange={(e) =>
                  setEditDesign({
                    ...editDesign,
                    description: e.target.value,
                  })
                }
              />
              <p className="text-xs text-neutral-500">
                {t("settings.design.editDescHint")}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
