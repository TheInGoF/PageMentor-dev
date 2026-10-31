// Was die Stimm-Engines gerade laden, für die Anzeige im Kopf: Engine startet, Modell lädt in den Grafikspeicher
// oder kommt aus dem Netz (mit Fortschritt). Quelle ist /status des GPU-Arbiters
import { baseUrl } from "../tts/engines/qwen/config";

export interface TtsActivity {
  engine: string;
  phase: "start" | "load" | "download";
  model?: string;
  seconds: number;
  bytes?: number;
  total?: number;
}

interface ArbiterStatus {
  starting?: { engine: string; seconds: number } | null;
  engines?: Record<string, { activity?: { phase: "load" | "download"; model: string; seconds: number; bytes?: number; total?: number } | null }>;
}

// Aus dem Arbiter-Stand: ein Download vor dem Laden vor dem bloßen Start
export function pickActivity(st: ArbiterStatus): TtsActivity | null {
  const found = Object.entries(st.engines ?? {})
    .filter(([, e]) => e.activity)
    .map(([engine, e]) => ({ engine, ...e.activity! }));
  const best = found.find((a) => a.phase === "download") ?? found[0];
  if (best) return best;
  return st.starting ? { engine: st.starting.engine, phase: "start", seconds: st.starting.seconds } : null;
}

export async function ttsActivity(): Promise<TtsActivity | null> {
  try {
    const r = await fetch(`${baseUrl()}/status`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    return pickActivity((await r.json()) as ArbiterStatus);
  } catch {
    return null;
  }
}
