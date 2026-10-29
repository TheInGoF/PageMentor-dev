// Ein Cloud-Anbieter in einer Zeile: Schlüssel und Modell nebeneinander, gespeicherter Schlüssel mit Entfernen
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { t } from "../../lib/i18n";

export function ApiProviderBlock(props: {
  label: string;
  placeholder: string;
  keyPresent: boolean;
  keyInput: string;
  onKeyChange: (v: string) => void;
  onRemove: () => void;
  modelLabel: string;
  modelPlaceholder: string;
  modelValue: string;
  onModelChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_16rem_auto] gap-2 items-end">
      <Input
        label={props.label}
        type="password"
        value={props.keyInput}
        onChange={(e) => props.onKeyChange(e.target.value)}
        placeholder={props.keyPresent ? `🔒 ${t("ai.expert.keyStored")}` : props.placeholder}
      />
      <Input label={props.modelLabel} value={props.modelValue} onChange={(e) => props.onModelChange(e.target.value)} placeholder={props.modelPlaceholder} />
      {props.keyPresent ? (
        <Button variant="ghost" onClick={props.onRemove}>
          {t("settings.llm.removeKey")}
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}
