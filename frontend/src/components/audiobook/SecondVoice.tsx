// Zweisprachiges Lehrbuch: Stimme für die zweite Sprache wählen; nur sichtbar, wenn das Buch eine hat
import { useEffect, useState } from "react";
import { api, type Document, type Voice } from "../../lib/api";
import { t } from "../../lib/i18n";

export function SecondVoice({ docId, voices }: { docId: string; voices: Voice[] }) {
  const [doc, setDoc] = useState<Document | null>(null);
  useEffect(() => {
    void api.documents.get(docId).then(setDoc).catch(() => setDoc(null));
  }, [docId]);
  const lang = doc?.second_language;
  if (!lang) return null;
  const options = voices.filter((v) => v.language === lang);

  async function pick(id: string) {
    setDoc(await api.documents.patch(docId, { voice2: id || null }));
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-neutral-400">{t("audiobook.voice2", { lang: t(`lang.name.${lang}`) })}</label>
      {options.length ? (
        <select className="input max-w-xs" value={doc?.voice2 ?? ""} onChange={(e) => void pick(e.target.value)}>
          <option value="">{t("audiobook.voice2.none")}</option>
          {options.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} · {t(`audiobook.engine.${v.engine}`)}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs text-neutral-500">{t("audiobook.voice2.missing")}</p>
      )}
      <p className="text-xs text-neutral-500">{t("audiobook.voice2.hint")}</p>
    </div>
  );
}
