// Umwandlung der PDFs (Docling): teure Zusatzschritte ein- und ausschalten
import { t } from "../../lib/i18n";
import type { SettingsState } from "./state";
import { Card, SettingRow } from "./parts";

export function DoclingSection({ st }: { st: SettingsState }) {
  const { llmConfig, setLlmConfig } = st;
  return (
    <Card title={t("docling.title")}>
      <SettingRow label={t("docling.charts")} hint={t("docling.chartsHint")}>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={llmConfig.doclingCharts === "1"}
            onChange={(e) => setLlmConfig({ ...llmConfig, doclingCharts: e.target.checked ? "1" : "" })}
          />
          {t("settings.abs.enableShort")}
        </label>
      </SettingRow>
    </Card>
  );
}
