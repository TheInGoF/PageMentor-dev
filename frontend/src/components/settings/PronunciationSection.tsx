// Aussprache-Liste für deutsche Stimmen: Wort → wie gesprochen (Anglizismen, Produktnamen).
// Greift vor jeder Sprachausgabe; Änderungen erneuern betroffene Kapitel beim nächsten Hörbuch-Lauf
import { useEffect, useState } from "react";
import { api, type PronunciationEntry } from "../../lib/api";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { Card } from "./parts";

export function PronunciationSection() {
  const [rows, setRows] = useState<PronunciationEntry[]>([]);
  const [saved, setSaved] = useState("");
  const [custom, setCustom] = useState(false);
  const toast = useToast();

  const apply = (r: { entries: PronunciationEntry[]; custom: boolean }) => {
    setRows(r.entries);
    setSaved(JSON.stringify(r.entries));
    setCustom(r.custom);
  };
  useEffect(() => {
    void api.pronunciation.get().then(apply);
  }, []);

  const set = (i: number, patch: Partial<PronunciationEntry>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows) !== saved;

  return (
    <Card title={t("pron.title")} status={custom ? t("pron.custom") : t("pron.default")}>
      <p className="text-xs text-neutral-500">{t("pron.hint")}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
            <input className="input" value={r.from} placeholder={t("pron.from")} onChange={(e) => set(i, { from: e.target.value })} aria-label={t("pron.from")} />
            <span className="text-neutral-500" aria-hidden>
              →
            </span>
            <input className="input" value={r.to} placeholder={t("pron.to")} onChange={(e) => set(i, { to: e.target.value })} aria-label={t("pron.to")} />
            <Button variant="ghost" className="!px-2" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))} aria-label={t("common.delete")} title={t("common.delete")}>
              ✕
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setRows((cur) => [...cur, { from: "", to: "" }])}>
          + {t("pron.add")}
        </Button>
        <Button
          onClick={async () => {
            apply(await api.pronunciation.save(rows));
            toast.show(t("pron.saved"), "success");
          }}
          disabled={!dirty}
        >
          {t("common.save")}
        </Button>
        <Button
          variant="ghost"
          disabled={!custom}
          onClick={async () => {
            if (!confirm(t("pron.resetConfirm"))) return;
            apply(await api.pronunciation.reset());
          }}
        >
          {t("pron.reset")}
        </Button>
      </div>
    </Card>
  );
}
