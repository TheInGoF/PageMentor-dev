// Gemma-Anweisungen: eigene Fassung bearbeiten; „Original“ holt die mitgelieferte zurück, auch nach einem Update
import { useEffect, useState } from "react";
import { api, type PromptInfo } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { Expert, Notice, SettingRow } from "./parts";

export function PromptsSection() {
  const [prompts, setPrompts] = useState<PromptInfo[]>([]);
  const [id, setId] = useState("audio-intro.de");
  const [draft, setDraft] = useState("");
  const toast = useToast();

  useEffect(() => {
    void api.prompts.list().then((r) => setPrompts(r.prompts));
  }, []);
  const cur = prompts.find((p) => p.id === id);
  useEffect(() => setDraft(cur?.text ?? ""), [cur?.text, id]);

  const update = (p: PromptInfo) => setPrompts((list) => list.map((x) => (x.id === p.id ? p : x)));
  async function save() {
    update(await api.prompts.save(id, draft));
    toast.show(t("prompts.saved"), "success");
  }
  async function reset() {
    if (!confirm(t("prompts.resetConfirm"))) return;
    update(await api.prompts.reset(id));
    toast.show(t("prompts.resetDone"), "success");
  }

  return (
    <Expert title={t("prompts.title")}>
      <p className="text-xs text-neutral-500">{t("prompts.hint")}</p>
      <SettingRow label={t("prompts.which")} hint={cur?.custom ? t("prompts.custom") : t("prompts.original")}>
        <select className="input w-full" value={id} onChange={(e) => setId(e.target.value)}>
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {t(`prompts.name.${p.id.split(".")[0]}`)} · {p.id.split(".")[1].toUpperCase()}
              {p.custom ? " ✎" : ""}
            </option>
          ))}
        </select>
      </SettingRow>
      {cur?.originalChanged && <Notice kind="warn">{t("prompts.originalChanged")}</Notice>}
      <textarea className="input min-h-[320px] font-mono text-xs leading-relaxed resize-y" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={!cur || draft === cur.text || !draft.trim()}>
          {t("common.save")}
        </Button>
        <Button variant="outline" onClick={reset} disabled={!cur?.custom}>
          {t("prompts.reset")}
        </Button>
        {cur && draft !== cur.text && (
          <Button variant="ghost" onClick={() => setDraft(cur.text)}>
            {t("prompts.discard")}
          </Button>
        )}
      </div>
    </Expert>
  );
}
