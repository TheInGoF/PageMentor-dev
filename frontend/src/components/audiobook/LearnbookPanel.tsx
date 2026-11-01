// Lernhörbuch und Sprachlern-Hörbuch: Zustand und Aktionen als Hook (für den gemeinsamen Bedien-Kopf im Hörbuch-Reiter),
// darunter die eigene Ansicht mit Zielsprache, Modell, Meldungen und Einheiten (Skript, Merkpunkte, Prüfnotiz hinter ⋯)
import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Menu } from "../ui/Menu";
import { useToast } from "../ui/Toast";
import { Notice, SettingRow } from "../settings/parts";

interface Unit {
  idx: number;
  title: string | null;
  startPage: number;
  endPage: number;
  script: string | null;
  points: string[];
  checkNote: string | null;
  model: string | null;
  hasAudio: boolean;
  durationMs: number | null;
}
interface RunState {
  running: boolean;
  phase: "wait" | "script" | "audio" | "book" | "abs" | "done" | "failed" | "canceled";
  done: number;
  total: number;
  current?: string;
  error?: string;
  probe: boolean;
  bookPath?: string;
  absUrl?: string;
  absError?: string;
  waiting?: boolean;
  step?: "write" | "check" | "revise" | "speak";
  unitStartedAt?: number;
  partsDone?: number;
  partsTotal?: number;
}
interface Info {
  kind: "language" | "subject";
  lang: string;
  model: string | null;
  units: Unit[];
  state: RunState | null;
  hasBook?: boolean;
  abs?: boolean;
}

const LANGS = ["es", "en", "fr", "it", "pt"];
export const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;

export type LearnKind = "language" | "subject";

export function useLearnbook(docId: string, kind: LearnKind, rate: string, enabled: boolean) {
  const [info, setInfo] = useState<Info | null>(null);
  const [absBusy, setAbsBusy] = useState(false);
  const toast = useToast();
  const base = `/api/learnbook/${docId}`;
  const load = () => request<Info>(base).then(setInfo).catch(() => undefined);
  useEffect(() => {
    if (enabled) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, enabled]);
  const running = !!info?.state?.running;
  // Sekundentakt für die Laufzeit der aktuellen Einheit, Stand alle 4 s
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running || !enabled) return;
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    const poll = setInterval(() => void load(), 4000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, enabled]);

  // Gewählt ist der Knopf oben; das Heft stellt erst beim Start um, damit Anschauen nichts verwirft
  const other = !!info && info.kind !== kind;
  const call = async (path: string, body?: object) => {
    await request(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    await load();
  };
  const start = async (probe: boolean) => {
    if (other) await request(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
    await call("/start", { probe, rate });
  };
  const cancel = () => call("/cancel");
  const setLang = async (lang: string) => {
    await request(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang }) });
    await load();
  };
  const uploadAbs = async () => {
    setAbsBusy(true);
    try {
      await request(`${base}/abs`, { method: "POST" });
      toast.show(t("learn.absDone"), "success");
    } catch (err) {
      toast.show(err instanceof Error ? err.message : t("common.error"), "error");
    } finally {
      setAbsBusy(false);
    }
  };
  const hasAudio = !other && !!info?.units.some((u) => u.hasAudio);
  const menu = [
    ...(!other && info?.hasBook ? [{ label: t("audiobook.download.m4b"), onClick: () => window.open(`${base}/book`, "_blank") }] : []),
    ...(!other && info?.hasBook && info.abs ? [{ label: absBusy ? t("learn.absUploading") : t("learn.absUpload"), onClick: () => void uploadAbs(), disabled: absBusy || running }] : []),
  ];
  return { info, other, running, st: info?.state ?? null, start, cancel, setLang, hasAudio, menu, base, load };
}

export type LearnbookCtl = ReturnType<typeof useLearnbook>;

// Fortschritt für den Bedien-Kopf: was gerade passiert, Schritt mit Laufzeit, Balken
export function LearnbookProgress({ ctl }: { ctl: LearnbookCtl }) {
  const st = ctl.st;
  if (!st?.running) return null;
  return (
    <div className="flex flex-col gap-1 w-full">
      <span className="text-sm">
        {st.waiting ? t("learn.phase.wait") : t(`learn.phase.${st.phase}`, { done: Math.min(st.done + 1, Math.max(1, st.total)), total: st.total, current: st.current ?? "" })}
      </span>
      {!st.waiting && st.step && (st.phase === "script" || st.phase === "audio") && (
        <span className="text-xs text-neutral-500 tabular-nums">
          {t(`learn.step.${st.step}`)}
          {st.step === "speak" && st.partsTotal ? ` · ${t("learn.parts", { done: st.partsDone ?? 0, total: st.partsTotal })}` : ""}
          {st.unitStartedAt ? ` · ${mmss(Date.now() - st.unitStartedAt)}` : ""}
        </span>
      )}
      {st.total > 0 && (
        <div className="h-1.5 rounded bg-bg-elevated overflow-hidden">
          <div
            className="h-full bg-accent transition-[width] duration-500"
            style={{ width: `${Math.min(100, ((st.done + (st.step === "speak" && st.partsTotal ? (st.partsDone ?? 0) / st.partsTotal : 0)) / st.total) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// Ansicht unter dem Kopf: Zielsprache, Modell, Meldungen, Einheiten
export function LearnbookBody({ ctl, kind }: { ctl: LearnbookCtl; kind: LearnKind }) {
  const [open, setOpen] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const { info, other, running, st } = ctl;
  if (!info) return null;
  const play = (idx: number) => {
    audio.current?.pause();
    audio.current = new Audio(`${ctl.base}/unit/${idx}/audio?t=${Date.now()}`);
    void audio.current.play();
  };
  const totalMs = info.units.reduce((a, u) => a + (u.durationMs ?? 0), 0);

  return (
    <section className="card p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <p className="text-xs text-neutral-500 flex-1">{t(`learn.kind.${kind}Hint`)}</p>
        {!other && totalMs > 0 && <span className="text-xs text-neutral-500">{t("learn.total", { n: info.units.filter((u) => u.hasAudio).length, time: mmss(totalMs) })}</span>}
      </div>
      {other && info.units.some((u) => u.script) && <Notice kind="warn">{t("learn.otherKind", { kind: t(`learn.kind.${info.kind}`) })}</Notice>}

      {kind === "language" && (
        <SettingRow label={t("learn.lang")}>
          <select className="input w-full" value={info.lang} disabled={running} onChange={(e) => void ctl.setLang(e.target.value)}>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {t(`lang.name.${l}`)}
              </option>
            ))}
          </select>
        </SettingRow>
      )}
      <SettingRow label={t("learn.model")} hint={info.model ? undefined : t("learn.modelHint")}>
        <span className="text-sm">{info.model ?? t("learn.defaultModel")}</span>
      </SettingRow>

      {st?.phase === "failed" && <Notice kind="error">{st.error}</Notice>}
      {st?.phase === "done" && st.bookPath && <Notice>{t("learn.saved", { path: st.bookPath })}</Notice>}
      {st?.phase === "done" && st.absUrl && <Notice>{t("learn.absDone")}</Notice>}
      {st?.phase === "done" && st.absError && <Notice kind="warn">{t("learn.absFailed", { error: st.absError })}</Notice>}

      {!other && info.units.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {info.units.map((u) => (
            <li key={u.idx} className="py-2 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm truncate", !u.script && "text-neutral-500")}>
                    {u.idx + 1}. {u.title ?? t("learn.unitOpen")}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {t("learn.pages", { from: u.startPage, to: u.endPage })}
                    {u.durationMs ? ` · ${mmss(u.durationMs)}` : ""}
                    {u.checkNote ? ` · ${u.checkNote.split("\n")[0]}` : ""}
                  </div>
                </div>
                {u.hasAudio && (
                  <button type="button" className="chip" onClick={() => play(u.idx)}>
                    ▶ {t("learn.play")}
                  </button>
                )}
                <Menu
                  label={t("learn.actions")}
                  items={[{ label: t(open === u.idx ? "learn.hideScript" : "learn.showScript"), onClick: () => setOpen(open === u.idx ? null : u.idx), disabled: !u.script }]}
                />
              </div>
              {open === u.idx && u.script && (
                <div className="flex flex-col gap-2 rounded-md border border-border p-2">
                  {u.checkNote && <Notice kind={/korrigiert|keine Abweichung/.test(u.checkNote) ? "info" : "warn"}><span className="whitespace-pre-wrap">{u.checkNote}</span></Notice>}
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">{u.script}</div>
                  {u.points.length > 0 && (
                    <div className="text-xs text-neutral-500">
                      {t("learn.points")}: {u.points.join(" · ")}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
