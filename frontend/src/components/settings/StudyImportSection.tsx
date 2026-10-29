// Übernahme aus dem Studium Maker: Ordner wählen, Probelauf ansehen, dann übernehmen
import { useState } from "react";
import { Button } from "../ui/Button";
import { api, type ImportCount, type StudyImportReport } from "../../lib/api";
import { isFrameless } from "../../lib/desktop";
import { t } from "../../lib/i18n";
import { Expert } from "./parts";

const ROWS = ["modules", "prefixes", "assessments", "time", "material", "trainers", "examDates"] as const;

function Row({ label, c }: { label: string; c: ImportCount }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1.5 pr-4">{label}</td>
      <td className="py-1.5 pr-4 tabular-nums">{c.created}</td>
      <td className="py-1.5 pr-4 tabular-nums">{c.updated}</td>
      <td className="py-1.5 tabular-nums text-neutral-500">{c.skipped}</td>
    </tr>
  );
}

export function StudyImportSection() {
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<StudyImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    const r = await api.study.pickFolder().catch(() => ({ folder: null }));
    if (r.folder) {
      setFolder(r.folder);
      setReport(null);
    }
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.study.import(folder.trim(), dryRun));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Einmalige Übernahme: eingeklappt am Ende der Seite
    <Expert title={t("study.import.title")}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-neutral-500">{t("study.import.hint")}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="input flex-1"
            value={folder}
            placeholder={t("study.import.folder")}
            onChange={(e) => {
              setFolder(e.target.value);
              setReport(null);
            }}
          />
          {isFrameless() && (
            <Button variant="outline" onClick={pick} disabled={busy}>
              {t("study.import.pick")}
            </Button>
          )}
          <Button variant="outline" onClick={() => run(true)} disabled={busy || !folder.trim()}>
            {t("study.import.dryRun")}
          </Button>
        </div>

        {error && <div className="rounded-md bg-red-500/10 text-red-600 text-sm px-3 py-2">{error}</div>}

        {report && (
          <div className="flex flex-col gap-3">
            <div className="text-sm font-medium">
              {report.dryRun ? t("study.import.previewDone") : t("study.import.done")}
              {" · "}
              {t("study.import.progress", { cp: report.progress.earnedCp, avg: report.progress.average?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "–" })}
            </div>
            <table className="text-sm w-full max-w-xl">
              <thead className="text-xs text-neutral-500 text-left">
                <tr>
                  <th className="font-normal pb-1" />
                  <th className="font-normal pb-1">{t("study.import.created")}</th>
                  <th className="font-normal pb-1">{t("study.import.updated")}</th>
                  <th className="font-normal pb-1">{t("study.import.skipped")}</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((k) => (
                  <Row key={k} label={t(`study.import.row.${k}`)} c={report[k]} />
                ))}
              </tbody>
            </table>
            {report.warnings.length > 0 && (
              <details className="rounded-md bg-amber-500/10 text-sm px-3 py-2">
                <summary className="cursor-pointer">{t("study.import.warnings", { n: report.warnings.length })}</summary>
                <ul className="mt-2 list-disc pl-5 text-neutral-500 max-h-60 overflow-y-auto">
                  {report.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            {report.dryRun && (
              <div>
                <Button onClick={() => run(false)} disabled={busy}>
                  {t("study.import.apply")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Expert>
  );
}
