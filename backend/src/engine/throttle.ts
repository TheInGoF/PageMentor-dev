// Download-Bremse: Modell- und Paket-Downloads sollen die Leitung nicht lahmlegen. Beim ersten Download misst die App
// 60 s lang die Empfangsrate der Engine-Umgebung (ohne Bremse) und begrenzt danach alles, was in der Umgebung
// ankommt, auf einen Anteil der höchsten Durchschnittsrate (Standard 90 %). Umgesetzt mit tc-Ingress-Policing auf der
// Netzwerkkarte der WSL-Umgebung; Verkehr vom Windows-Rechner selbst (App ↔ Dienste) bleibt ungebremst
import { IS_WINDOWS } from "../paths";
import { failText, inDistro, logEngine } from "./exec";
import { getLlmConfig, setLlmConfig } from "../services/llmConfig";

export const DEFAULT_PCT = 90;
const MEASURE_SEC = 60;
// Gleitender Durchschnitt über 10 s: kurze Spitzen zählen nicht als Leitungsrate
const WINDOW_SEC = 10;
// Darunter war kein echter Download unterwegs: Messung verwerfen
const MIN_MBIT = 5;

export interface ThrottleStatus {
  pct: number;
  maxMbit: number | null;
  limitMbit: number | null;
  measuring: boolean;
  // tc fehlt oder der WSL-Kernel kann kein Ingress-Policing
  error?: string;
}

let measuring = false;
let lastError: string | undefined;

export function throttlePct(): number {
  const n = Number(getLlmConfig().downloadLimitPct);
  return Number.isFinite(n) && n >= 10 && n <= 100 ? Math.round(n) : DEFAULT_PCT;
}

function storedMax(): number | null {
  const n = Number(getLlmConfig().downloadMaxMbit);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Grenze in Mbit/s; null = keine Bremse (100 % oder noch nicht gemessen)
export function limitFor(maxMbit: number | null, pct: number): number | null {
  if (!maxMbit || pct >= 100) return null;
  return Math.max(1, Math.round((maxMbit * pct) / 100));
}

export function throttleStatus(): ThrottleStatus {
  const pct = throttlePct();
  const maxMbit = storedMax();
  return { pct, maxMbit, limitMbit: limitFor(maxMbit, pct), measuring, error: lastError };
}

// Höchste Durchschnittsrate (Mbit/s) aus Messpunkten "Sekunden Bytes" (Zähler der Netzwerkkarte)
export function peakMbit(samples: Array<{ t: number; bytes: number }>, windowSec = WINDOW_SEC): number {
  if (samples.length < 2) return 0;
  // Kürzere Messung: ein Fenster über alles
  const win = Math.min(windowSec, samples[samples.length - 1].t - samples[0].t);
  if (win <= 0) return 0;
  let best = 0;
  for (let i = 0, j = 1; i < samples.length; i++) {
    while (j < samples.length && samples[j].t - samples[i].t < win) j++;
    if (j >= samples.length) break;
    best = Math.max(best, ((samples[j].bytes - samples[i].bytes) * 8) / (samples[j].t - samples[i].t) / 1e6);
  }
  return Math.round(best * 10) / 10;
}

export function parseSamples(text: string): Array<{ t: number; bytes: number }> {
  return text
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
    .map(([t, bytes]) => ({ t, bytes }));
}

const DEV = `DEV=$(ip -o -4 route show default | awk '{print $5; exit}'); GW=$(ip -o -4 route show default | awk '{print $3; exit}'); [ -n "$DEV" ] || { echo 'Kein Netzwerk in der Engine-Umgebung'; exit 3; }`;

// tc-Befehle für eine Grenze; null nimmt die Bremse heraus
export function tcScript(limitMbit: number | null): string {
  const lines = [
    "command -v tc >/dev/null || apt-get install -y -qq iproute2 >/dev/null 2>&1 || { echo 'tc fehlt'; exit 4; }",
    DEV,
    'tc qdisc del dev "$DEV" ingress 2>/dev/null || true',
  ];
  if (limitMbit) {
    const kbit = limitMbit * 1000;
    // Puffer etwa 0,1 s der Rate, mindestens 64 kB: sonst bricht TCP zu oft ein
    const burstKb = Math.max(64, Math.round(kbit / 8 / 10));
    lines.push(
      'tc qdisc add dev "$DEV" handle ffff: ingress',
      '[ -z "$GW" ] || tc filter add dev "$DEV" parent ffff: protocol ip prio 1 u32 match ip src "$GW"/32 flowid :1',
      `tc filter add dev "$DEV" parent ffff: protocol all prio 2 u32 match u32 0 0 police rate ${kbit}kbit burst ${burstKb}k drop flowid :1`
    );
  }
  return lines.join(" && ");
}

async function setTc(limitMbit: number | null): Promise<void> {
  if (!IS_WINDOWS) return;
  const r = await inDistro(tcScript(limitMbit), { timeoutMs: 120_000, quiet: true });
  if (r.code !== 0) {
    lastError = `Download-Bremse nicht möglich: ${failText(r)}`;
    logEngine("warn", lastError);
    return;
  }
  lastError = undefined;
}

// Gespeicherte Grenze setzen (Start der Engine, geänderte Einstellung)
export async function applyThrottle(): Promise<ThrottleStatus> {
  await setTc(throttleStatus().limitMbit);
  return throttleStatus();
}

// Einstellungen: Anteil ändern oder Messung verwerfen (dann misst der nächste Download neu)
export async function setThrottle(patch: { pct?: number; remeasure?: boolean }): Promise<ThrottleStatus> {
  if (patch.pct !== undefined) setLlmConfig({ downloadLimitPct: String(Math.min(100, Math.max(10, Math.round(patch.pct)))) });
  if (patch.remeasure) setLlmConfig({ downloadMaxMbit: "" });
  return applyThrottle();
}

async function measure(): Promise<number | null> {
  const r = await inDistro(`${DEV}; for i in $(seq 0 ${MEASURE_SEC}); do echo "$(date +%s.%N) $(cat /sys/class/net/$DEV/statistics/rx_bytes)"; sleep 1; done`, {
    timeoutMs: (MEASURE_SEC + 60) * 1000,
    quiet: true,
  });
  if (r.code !== 0) return null;
  const peak = peakMbit(parseSamples(r.stdout));
  return peak >= MIN_MBIT ? peak : null;
}

// Um einen Download legen: ohne Messwert erst 60 s ungebremst messen, dann die Grenze setzen; sonst gleich bremsen
export async function withDownloadLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (!IS_WINDOWS || throttlePct() >= 100) return fn();
  if (storedMax() || measuring) {
    await applyThrottle();
    return fn();
  }
  measuring = true;
  await setTc(null);
  const probe = measure()
    .then(async (peak) => {
      if (!peak) return;
      setLlmConfig({ downloadMaxMbit: String(peak) });
      const st = await applyThrottle();
      logEngine("info", `Download-Rate gemessen: ${peak} Mbit/s, Grenze ${st.limitMbit} Mbit/s (${st.pct} %)`);
    })
    .catch((err) => logEngine("warn", "Messung der Download-Rate fehlgeschlagen", err))
    .finally(() => (measuring = false));
  // Kurzer Download: die Messung läuft zu Ende, damit die Grenze für den nächsten steht
  void probe;
  return fn();
}
