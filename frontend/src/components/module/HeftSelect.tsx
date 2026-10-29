// Auswahl „Alle Hefte“ oder ein Heft des Moduls: alle zeigt den Überblick, ein Heft das Werkzeug dazu
import type { ModuleDocument } from "../../lib/api";
import { t } from "../../lib/i18n";

export function HeftSelect({ docs, value, onChange, allowAll = true }: { docs: ModuleDocument[]; value: string; onChange: (id: string) => void; allowAll?: boolean }) {
  return (
    <select className="input !w-auto max-w-full" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t("module.heft.label")}>
      {allowAll && <option value="">{t("module.heft.all")}</option>}
      {docs.map((d) => (
        <option key={d.id} value={d.id}>
          {d.title}
        </option>
      ))}
    </select>
  );
}
