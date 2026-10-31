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

export function LearnbookPanel({ docId, rate }: { docId: string; rate: string }) {
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
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => void load(), 4000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  if (!info) return null;
  const st = info.state;
  const post = async (path: string, body?: object) => {
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
        <h2 className="text-base font-semibold flex-1">{t("learn.title")}</h2>
        {totalMs > 0 && <span className="text-xs text-neutral-500">{t("learn.total", { n: info.units.filter((u) => u.hasAudio).length, time: mmss(totalMs) })}</span>}
      </div>
      <p className="text-xs text-neutral-500">{t("learn.hint")}</p>

      <SettingRow label={t("learn.kind")} hint={t(`learn.kind.${info.kind}Hint`)}>
        <div className="flex gap-2">
          {(["language", "subject"] as const).map((k) => (
            <button key={k} type="button" className={cn("chip flex-1", info.kind === k && "chip-active")} disabled={running} onClick={() => void setKind({ kind: k })}>
              {t(`learn.kind.${k}`)}
            </button>
          ))}
        </div>
      </SettingRow>
      {info.kind === "language" && (
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
          {t(`learn.phase.${st.phase}`, { done: st.done, total: st.total, current: st.current ?? "" })}
        </Notice>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void post("/start", { probe: true, rate })}>
            {t("learn.probe")}
          </Button>
          <Button onClick={() => void post("/start", { probe: false, rate })}>{t(info.units.some((u) => u.hasAudio) ? "learn.update" : "learn.full")}</Button>
        </div>
      )}
      {st?.phase === "failed" && <Notice kind="error">{st.error}</Notice>}
      {st?.phase === "done" && st.bookPath && <Notice>{t("learn.saved", { path: st.bookPath })}</Notice>}

      {info.units.length > 0 && (
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
