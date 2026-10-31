// Stimm-Engine lädt: Engine startet, Modell lädt in den Grafikspeicher oder kommt aus dem Netz (mit Fortschritt).
// Steht im Kopf, solange es dauert; sonst unsichtbar. Erklärt die Wartezeit beim ersten Satz in neuer Sprache
import { useEffect, useState } from "react";
import { request } from "../../lib/api/request";
import { t } from "../../lib/i18n";

interface Activity {
  engine: string;
  phase: "start" | "load" | "download";
  model?: string;
  seconds: number;
  bytes?: number;
  total?: number;
}

const ENGINE: Record<string, string> = { f5: "F5", qwen: "Qwen", kokoro: "Kokoro", tada: "TADA" };
const gb = (b: number) => (b / 1e9).toFixed(1).replace(".", ",");
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// "F5 Spanish" → "Spanish"; Hub-Pfade auf den Dateinamen kürzen
function modelLabel(a: Activity): string {
  const m = a.model ?? "";
  return m.replace(/^F5 /, "").split("/").slice(-1)[0];
}

export function TtsActivityIndicator() {
  const [a, setA] = useState<Activity | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      void request<{ activity: Activity | null }>("/api/audio/tts-activity")
        .then((r) => !stop && setA(r.activity))
        .catch(() => undefined);
    load();
    // Schneller nachsehen, solange etwas lädt
    const iv = setInterval(load, a ? 2000 : 5000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [!!a]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return null;
  const engine = ENGINE[a.engine] ?? a.engine;
  const pct = a.phase === "download" && a.total ? Math.min(99, Math.round(((a.bytes ?? 0) / a.total) * 100)) : null;
  const text =
    a.phase === "start"
      ? t("ttsActivity.start", { engine, time: mmss(a.seconds) })
      : a.phase === "download"
        ? t("ttsActivity.download", { engine, model: modelLabel(a), progress: pct !== null ? `${pct} %` : mmss(a.seconds) })
        : t("ttsActivity.load", { engine, model: modelLabel(a), time: mmss(a.seconds) });
  const title =
    a.phase === "download" && a.total
      ? t("ttsActivity.downloadHint", { done: gb(a.bytes ?? 0), total: gb(a.total) })
      : t("ttsActivity.hint");
  return (
    <span className="px-2 py-1 rounded-md text-xs border border-amber-500/40 bg-amber-500/10 whitespace-nowrap" title={title} role="status">
      {text}
    </span>
  );
}
