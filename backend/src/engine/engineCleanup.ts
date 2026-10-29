// Abgeschaltete Zusatzstimmen nach 14 Tagen löschen: Paket, Container und Modelle, damit der Platz frei wird
import { getLlmConfig, setLlmConfig } from "../services/llmConfig";
import { inDistro, logEngine } from "./exec";
import { EXTRA_SERVICES, enabledExtras, type ExtraEngine } from "./extraEngines";

export const UNUSED_DAYS = 14;
const DAY_MS = 24 * 3600_000;
const VOLUME_PREFIX = "pagementor-engine_";

// Was je Engine auf der Platte liegt; F5 und TADA teilen sich das Volume tts-hf
const DATA: Record<ExtraEngine, { image: string; volume: string; models: string[] }> = {
  qwen: { image: "ghcr.io/theingof/pm-qwen-tts-dev", volume: "qwen-tts-hf", models: [] },
  f5: { image: "ghcr.io/theingof/pm-f5-tts", volume: "tts-hf", models: ["aihpi--F5-TTS-German", "charactr--vocos-mel-24khz"] },
  tada: { image: "ghcr.io/theingof/pm-tada-tts", volume: "tts-hf", models: ["HumeAI--tada-3b-ml", "HumeAI--tada-codec", "meta-llama--Llama-3.2-1B"] },
};

// Je abgeschalteter Engine: seit wann aus, ob schon gelöscht
export type OffState = Partial<Record<ExtraEngine, { since: number; cleaned?: boolean }>>;

function readOffState(): OffState {
  try {
    return JSON.parse(getLlmConfig().ttsEnginesOff ?? "{}") as OffState;
  } catch {
    return {};
  }
}

// Eingeschaltete fallen raus, neu abgeschaltete bekommen die Uhrzeit von jetzt
export function nextOffState(prev: OffState, enabled: ExtraEngine[], now: number): OffState {
  const next: OffState = {};
  for (const e of Object.keys(EXTRA_SERVICES) as ExtraEngine[]) {
    if (enabled.includes(e)) continue;
    next[e] = prev[e] ?? { since: now };
  }
  return next;
}

export function dueForCleanup(state: OffState, now: number): ExtraEngine[] {
  return (Object.keys(state) as ExtraEngine[]).filter((e) => {
    const s = state[e];
    return !!s && !s.cleaned && now - s.since >= UNUSED_DAYS * DAY_MS;
  });
}

export function trackEngineSwitch(): void {
  setLlmConfig({ ttsEnginesOff: JSON.stringify(nextOffState(readOffState(), enabledExtras(), Date.now())) });
}

function cleanupScript(e: ExtraEngine, alsoSharedVolume: boolean): string {
  const d = DATA[e];
  const vol = VOLUME_PREFIX + d.volume;
  const steps = [
    `docker rm -f pm-${EXTRA_SERVICES[e].service} >/dev/null 2>&1`,
    `docker images -q ${d.image} | sort -u | xargs -r docker rmi -f >/dev/null 2>&1`,
  ];
  if (!d.models.length || alsoSharedVolume) {
    steps.push(`docker volume rm -f ${vol} >/dev/null 2>&1`);
  } else {
    const paths = [...d.models.map((m) => `"$m/hub/models--${m}"`), `"$m/.pm-ready-${e}"`].join(" ");
    steps.push(`m=$(docker volume inspect -f '{{.Mountpoint}}' ${vol} 2>/dev/null) && [ -n "$m" ] && rm -rf ${paths}`);
  }
  return steps.map((s) => `(${s} || true)`).join("; ");
}

export async function cleanupUnusedEngines(now = Date.now()): Promise<ExtraEngine[]> {
  const state = nextOffState(readOffState(), enabledExtras(), now);
  const due = dueForCleanup(state, now);
  if (!due.length) {
    setLlmConfig({ ttsEnginesOff: JSON.stringify(state) });
    return [];
  }
  for (const e of due) {
    // Volume tts-hf ganz weg, wenn die andere Engine darauf auch aus ist
    const other: ExtraEngine | null = e === "f5" ? "tada" : e === "tada" ? "f5" : null;
    const sharedFree = other !== null && !!state[other] && (state[other]!.cleaned || due.includes(other));
    const r = await inDistro(cleanupScript(e, sharedFree), { timeoutMs: 15 * 60_000, quiet: true });
    if (r.code !== 0) continue;
    state[e] = { ...state[e]!, cleaned: true };
    logEngine("info", `${EXTRA_SERVICES[e].title} seit über ${UNUSED_DAYS} Tagen aus: Paket und Modelle gelöscht (etwa ${EXTRA_SERVICES[e].sizeGb} GB)`);
  }
  setLlmConfig({ ttsEnginesOff: JSON.stringify(state) });
  await inDistro("fstrim -a 2>/dev/null || true", { timeoutMs: 10 * 60_000, quiet: true });
  return due;
}
