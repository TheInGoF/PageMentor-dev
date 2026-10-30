// Aussprache-Liste für deutsche Stimmen: Wort → wie gesprochen (Anglizismen, Produktnamen, Abkürzungen).
// Anhören mit Pause davor und danach, abhaken was passt; geprüfte Einträge lernt Gemma als Beispiele.
// Gemma schlägt Neues vor (einzelnes Wort ✨ oder ein ganzes Heft), Vorschläge kommen ungeprüft dazu.
import { useEffect, useRef, useState } from "react";
import { api, type Document, type PronunciationEntry, type Voice } from "../../lib/api";
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
  const [asking, setAsking] = useState<number | "doc" | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [docId, setDocId] = useState("");
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
    void api.documents.list().then((d) => setDocs(d.filter((x) => x.ocr_status === "done")));
    return () => audio.current?.pause();
  }, []);

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
  const checkedCount = rows.filter((r) => r.checked).length;
  const model = () => getSettings().defaultOllamaModel || undefined;

  // Mit 1 s Stille davor und danach: F5 verschluckt sonst Anfang und Ende kurzer Beispiele
  function play(i: number) {
    const text = rows[i]?.to.trim();
    if (!text || !voiceId) return;
    audio.current?.pause();
    const a = new Audio(`${api.audio.previewUrl(voiceId, { text: `${text}.` })}&pad=1000`);
    audio.current = a;
    setPlaying(i);
    a.onended = a.onerror = () => setPlaying((cur) => (cur === i ? null : cur));
    void a.play().catch(() => setPlaying(null));
  }

  async function suggestRow(i: number) {
    setAsking(i);
    try {
      const { items } = await api.pronunciation.suggest({ words: [rows[i].from], model: model() });
      if (items[0]) set(i, { to: items[0].to, checked: false });
      else toast.show(t("pron.noSuggestion"), "error");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setAsking(null);
    }
  }

  async function scanDoc() {
    setAsking("doc");
    try {
      const { items } = await api.pronunciation.suggest({ docId, model: model() });
      const known = new Set(rows.map((r) => r.from.toLowerCase()));
      const fresh = items.filter((e) => !known.has(e.from.toLowerCase())).map((e) => ({ ...e, checked: false }));
      setRows((cur) => [...cur, ...fresh]);
      toast.show(t("pron.scanned", { n: fresh.length }), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setAsking(null);
    }
  }

  async function exportChecked() {
    await navigator.clipboard.writeText(JSON.stringify(rows.filter((r) => r.checked), null, 2));
    toast.show(t("pron.exported", { n: checkedCount }), "success");
  }

  return (
    <Card title={t("pron.title")} status={`${custom ? t("pron.custom") : t("pron.default")} · ${t("pron.checkedCount", { n: checkedCount })}`}>
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
          <li key={i} className="grid grid-cols-[auto_1fr_auto_1fr_auto_auto_auto] items-center gap-2">
            {/* Ganze Kästchen-Spalte klickbar (docs/STYLEGUIDE.md) */}
            <label className="self-stretch px-2 flex items-center cursor-pointer" title={t("pron.checked")}>
              <input type="checkbox" className="w-5 h-5 cursor-pointer" checked={!!r.checked} onChange={(e) => set(i, { checked: e.target.checked })} aria-label={t("pron.checked")} />
            </label>
            <input className="input" value={r.from} placeholder={t("pron.from")} onChange={(e) => set(i, { from: e.target.value, checked: false })} aria-label={t("pron.from")} />
            <span className="text-neutral-500" aria-hidden>
              →
            </span>
            <input className="input" value={r.to} placeholder={t("pron.to")} onChange={(e) => set(i, { to: e.target.value, checked: false })} aria-label={t("pron.to")} />
            <Button variant="ghost" className="!px-2" onClick={() => void suggestRow(i)} disabled={!r.from.trim() || asking !== null} aria-label={t("pron.suggest")} title={t("pron.suggest")}>
              {asking === i ? "…" : "✨"}
            </Button>
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
        <Button variant="ghost" onClick={() => void exportChecked()} disabled={!checkedCount}>
          {t("pron.export")}
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
      {docs.length > 0 && (
        <SettingRow label={t("pron.scan")} hint={t("pron.scanHint")}>
          <div className="flex gap-2">
            <select className="input flex-1 min-w-0" value={docId} onChange={(e) => setDocId(e.target.value)}>
              <option value="">{t("pron.scanPick")}</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={() => void scanDoc()} disabled={!docId || asking !== null}>
              {asking === "doc" ? "…" : "✨"}
            </Button>
          </div>
        </SettingRow>
      )}
    </Card>
  );
}
