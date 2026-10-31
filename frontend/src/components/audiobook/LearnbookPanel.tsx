// Lernhörbuch neben dem normalen Hörbuch: Art und Zielsprache wählen, erst eine Probe-Einheit anhören,
// dann das ganze Heft. Einheiten mit Skript, Merkpunkten und Prüfnotiz; Aktionen je Einheit hinter ⋯
import { useEffect, useRef, useState } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";
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
  phase: "wait" | "script" | "audio" | "book" | "done" | "failed" | "canceled";
  done: number;
  total: number;
  current?: string;
  error?: string;
  probe: boolean;
  bookPath?: string;
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
}

const LANGS = ["es", "en", "fr", "it", "pt"];
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;

export function LearnbookPanel({ docId, rate, kind }: { docId: string; rate: string; kind: "language" | "subject" }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const base = `/api/learnbook/${docId}`;

  const load = () => request<Info>(base).then(setInfo).catch(() => undefined);
  useEffect(() => {
    void load();
    return () => audio.current?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);
  const running = !!info?.state?.running;
  // Sekundentakt für die Laufzeit der aktuellen Einheit
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [running]);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => void load(), 4000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  if (!info) return null;
  const st = info.state;
  // Gewählt ist der Knopf oben; das Heft stellt erst beim Start um, damit Anschauen nichts verwirft
  const other = info.kind !== kind;
  const post = async (path: string, body?: object) => {
    if (path === "/start" && other) await request(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
    await request(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    await load();
  };
  const setKind = async (patch: { kind?: string; lang?: string }) => {
    await request(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    await load();
  };
  const play = (idx: number) => {
    audio.current?.pause();
    audio.current = new Audio(`${base}/unit/${idx}/audio?t=${Date.now()}`);
    void audio.current.play();
  };
  const totalMs = info.units.reduce((a, u) => a + (u.durationMs ?? 0), 0);

  return (
    <section className="card p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold flex-1">{t(`learn.title.${kind}`)}</h2>
        {!other && totalMs > 0 && <span className="text-xs text-neutral-500">{t("learn.total", { n: info.units.filter((u) => u.hasAudio).length, time: mmss(totalMs) })}</span>}
      </div>
      <p className="text-xs text-neutral-500">{t(`learn.kind.${kind}Hint`)}</p>
      {other && info.units.some((u) => u.script) && <Notice kind="warn">{t("learn.otherKind", { kind: t(`learn.kind.${info.kind}`) })}</Notice>}

      {kind === "language" && (
        <SettingRow label={t("learn.lang")}>
          <select className="input w-full" value={info.lang} disabled={running} onChange={(e) => void setKind({ lang: e.target.value })}>
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

      {st?.running ? (
        <Notice action={<Button variant="ghost" onClick={() => void post("/cancel")}>{t("common.cancel")}</Button>}>
          <div className="flex flex-col gap-2 w-full">
            <span>
              {st.waiting
                ? t("learn.phase.wait")
                : t(`learn.phase.${st.phase}`, { done: Math.min(st.done + 1, Math.max(1, st.total)), total: st.total, current: st.current ?? "" })}
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
        </Notice>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void post("/start", { probe: true, rate })}>
            {t("learn.probe")}
          </Button>
          <Button onClick={() => void post("/start", { probe: false, rate })}>{t(!other && info.units.some((u) => u.hasAudio) ? "learn.update" : "learn.full")}</Button>
        </div>
      )}
      {st?.phase === "failed" && <Notice kind="error">{st.error}</Notice>}
      {st?.phase === "done" && st.bookPath && <Notice>{t("learn.saved", { path: st.bookPath })}</Notice>}

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
