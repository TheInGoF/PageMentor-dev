// Aussprache-Liste für deutsche Stimmen: Wort → wie gesprochen (Anglizismen, Produktnamen).
// Greift vor jeder Sprachausgabe; Änderungen erneuern betroffene Kapitel beim nächsten Hörbuch-Lauf
import { useEffect, useRef, useState } from "react";
import { api, type PronunciationEntry, type Voice } from "../../lib/api";
import { getSettings } from "../../lib/settings";
import { t } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { Card, SettingRow } from "./parts";

export function PronunciationSection() {
  const [rows, setRows] = useState<PronunciationEntry[]>([]);
  const [saved, setSaved] = useState("");
  const [custom, setCustom] = useState(false);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const toast = useToast();

  // Testen mit einer deutschen Stimme, vorbelegt mit der Standardstimme
  useEffect(() => {
    void api.audio.voices().then((r) => {
      const de = r.voices.filter((v) => v.language === "de");
      setVoices(de);
      const pref = getSettings().defaultVoice;
      setVoiceId(de.some((v) => v.id === pref) ? pref : de[0]?.id ?? "");
    });
    return () => audio.current?.pause();
  }, []);

  function play(i: number) {
    const text = rows[i]?.to.trim();
    if (!text || !voiceId) return;
    audio.current?.pause();
    const a = new Audio(api.audio.previewUrl(voiceId, { text: `${text}.` }));
    audio.current = a;
    setPlaying(i);
    a.onended = a.onerror = () => setPlaying((cur) => (cur === i ? null : cur));
    void a.play().catch(() => setPlaying(null));
  }

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
      {voices.length > 0 && (
        <SettingRow label={t("pron.testVoice")}>
          <select className="input w-full" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {t(`audiobook.engine.${v.engine}`)}
              </option>
            ))}
          </select>
        </SettingRow>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto_1fr_auto_auto] items-center gap-2">
            <input className="input" value={r.from} placeholder={t("pron.from")} onChange={(e) => set(i, { from: e.target.value })} aria-label={t("pron.from")} />
            <span className="text-neutral-500" aria-hidden>
              →
            </span>
            <input className="input" value={r.to} placeholder={t("pron.to")} onChange={(e) => set(i, { to: e.target.value })} aria-label={t("pron.to")} />
            <Button variant="ghost" className="!px-2" onClick={() => play(i)} disabled={!voiceId || !r.to.trim() || playing === i} aria-label={t("pron.play")} title={t("pron.play")}>
              {playing === i ? "…" : "▶"}
            </Button>
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
